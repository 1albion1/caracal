mod entra;
mod export;
mod models;
mod mssql;
mod postgres;
mod sqlite;
mod store;

use models::{Connection, NewConnection, QueryResult, RecentConnection, TableMeta};
use mssql::Secret;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use store::{ConnectionStore, RecentStore};
use tauri::{Manager, State};

/// Service name under which secrets live in the Windows Credential Manager
/// (account = connection id): the password for SQL logins.
/// Kept as "db-manager" (the app's pre-rename name) so passwords saved
/// before the Caracal rename keep working.
const KEYRING_SERVICE: &str = "db-manager";

/// One-time migration from the pre-rename identifier's config directory so
/// existing connections, recents, and the Entra session survive the
/// "DB Manager" → "Caracal" rename.
fn migrate_legacy_config(config_dir: &std::path::Path) {
    if config_dir.join("connections.json").exists() {
        return;
    }
    let Some(parent) = config_dir.parent() else {
        return;
    };
    let legacy = parent.join("com.albionberisha.db-manager");
    if !legacy.is_dir() {
        return;
    }
    let _ = std::fs::create_dir_all(config_dir);
    for name in [
        "connections.json",
        "recent_connections.json",
        "entra_token.bin",
        "demo.db",
    ] {
        let source = legacy.join(name);
        if source.exists() {
            let _ = std::fs::copy(&source, config_dir.join(name));
        }
    }
}

fn keyring_entry(connection_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, connection_id)
        .map_err(|e| format!("Credential Manager unavailable: {e}"))
}

/// The Entra sign-in is shared by ALL Entra connections — the token covers
/// the Azure SQL resource, not one server — so the user signs in once, ever.
/// Access token cached in memory; refresh token DPAPI-encrypted on disk.
#[derive(Default)]
struct TokenCache(Mutex<HashMap<String, (String, Instant)>>);

const ENTRA_CACHE_KEY: &str = "entra";

async fn entra_token(app: &tauri::AppHandle) -> Result<String, String> {
    // 1. Unexpired cached access token.
    {
        let cache = app.state::<TokenCache>();
        let map = cache.0.lock().unwrap();
        if let Some((token, expiry)) = map.get(ENTRA_CACHE_KEY) {
            if *expiry > Instant::now() {
                return Ok(token.clone());
            }
        }
    }
    // 2. Silent renewal via the stored refresh token; 3. browser sign-in.
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let load_dir = config_dir.clone();
    let stored =
        tauri::async_runtime::spawn_blocking(move || entra::load_refresh_token(&load_dir))
            .await
            .map_err(|e| e.to_string())?;
    let token = match stored {
        Some(refresh) => match entra::from_refresh_token(&refresh).await {
            Ok(token) => token,
            Err(_) => entra::interactive_login(app).await?,
        },
        None => entra::interactive_login(app).await?,
    };

    let expiry = Instant::now() + Duration::from_secs(token.expires_in_secs.saturating_sub(120));
    app.state::<TokenCache>()
        .0
        .lock()
        .unwrap()
        .insert(ENTRA_CACHE_KEY.to_string(), (token.access_token.clone(), expiry));
    if let Some(refresh) = token.refresh_token.clone() {
        let store_dir = config_dir.clone();
        let stored = tauri::async_runtime::spawn_blocking(move || {
            entra::store_refresh_token(&store_dir, &refresh)
        })
        .await
        .map_err(|e| e.to_string())?;
        if let Err(e) = stored {
            // Sign-in still works this session; only persistence failed.
            eprintln!("warning: could not persist Entra refresh token: {e}");
        }
    }
    Ok(token.access_token)
}

/// Removes a connection's stored SQL password (Entra sign-in is global and
/// intentionally survives individual connection removal).
fn forget_secret(connection_id: &str) {
    if let Ok(entry) = keyring_entry(connection_id) {
        let _ = entry.delete_credential();
    }
}

/// The stored password for a password-authenticated connection (postgres,
/// or mssql with SQL login).
async fn stored_password(connection: &Connection) -> Result<String, String> {
    let id = connection.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        keyring_entry(&id)?.get_password().map_err(|e| {
            format!("No stored password for this connection ({e}). Re-create the connection.")
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Resolves the secret needed to open a server connection: stored password
/// for SQL logins, an Azure AD token for Entra, nothing for Windows auth.
async fn resolve_secret(
    app: &tauri::AppHandle,
    connection: &Connection,
) -> Result<Secret, String> {
    match connection.auth.as_deref() {
        Some("windows") => Ok(Secret::None),
        Some("entra") => Ok(Secret::AadToken(entra_token(app).await?)),
        _ => Ok(Secret::Password(stored_password(connection).await?)),
    }
}

#[tauri::command]
fn list_connections(store: State<ConnectionStore>) -> Vec<Connection> {
    store.list()
}

#[tauri::command]
fn list_recent_connections(recents: State<RecentStore>) -> Vec<RecentConnection> {
    recents.list()
}

#[tauri::command]
async fn add_connection(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    recents: State<'_, RecentStore>,
    input: NewConnection,
) -> Result<Connection, String> {
    let id = uuid::Uuid::new_v4().to_string();

    let connection = match input.driver.as_str() {
        "sqlite" => {
            if input.database.trim().is_empty() {
                return Err("Database file path is required.".into());
            }
            // Verify the file actually opens as a SQLite database before saving.
            let database = input.database.clone();
            let create = input.create_if_missing;
            tauri::async_runtime::spawn_blocking(move || {
                sqlite::open(&database, create).map(|_| ())
            })
            .await
            .map_err(|e| e.to_string())??;

            Connection {
                id,
                name: default_name(&input.name, &input.database),
                driver: input.driver,
                host: "local".into(),
                database: input.database,
                color: input.color,
                port: None,
                username: None,
                auth: None,
                trust_cert: None,
            }
        }
        "mssql" => {
            let host = input.host.clone().unwrap_or_default();
            if host.trim().is_empty() {
                return Err("Server host is required.".into());
            }
            let auth = input.auth.clone().unwrap_or_else(|| "sql".into());
            if auth == "sql" && input.username.clone().unwrap_or_default().trim().is_empty() {
                return Err("Login name is required for SQL authentication.".into());
            }

            let connection = Connection {
                id: id.clone(),
                name: default_name(&input.name, &host),
                driver: input.driver,
                host: host.trim().to_string(),
                database: input.database.trim().to_string(),
                color: input.color,
                port: input.port,
                username: input.username.clone(),
                auth: Some(auth.clone()),
                trust_cert: input.trust_cert,
            };

            // Validate the connection end-to-end before saving anything.
            let secret = match auth.as_str() {
                "windows" => Secret::None,
                // Browser sign-in only if there's no valid shared session yet.
                "entra" => Secret::AadToken(entra_token(&app).await?),
                _ => Secret::Password(input.password.clone().unwrap_or_default()),
            };
            mssql::test_connection(&connection, secret).await?;

            // Only after a successful connect does the password get stored.
            if auth == "sql" {
                let password = input.password.clone().unwrap_or_default();
                let entry_id = id.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    keyring_entry(&entry_id)?
                        .set_password(&password)
                        .map_err(|e| format!("Could not store password: {e}"))
                })
                .await
                .map_err(|e| e.to_string())??;
            }
            connection
        }
        "postgres" => {
            let host = input.host.clone().unwrap_or_default();
            if host.trim().is_empty() {
                return Err("Server host is required.".into());
            }
            if input.username.clone().unwrap_or_default().trim().is_empty() {
                return Err("Username is required.".into());
            }

            let connection = Connection {
                id: id.clone(),
                name: default_name(&input.name, &host),
                driver: input.driver,
                host: host.trim().to_string(),
                database: input.database.trim().to_string(),
                color: input.color,
                port: input.port,
                username: input.username.clone(),
                auth: Some("sql".into()),
                trust_cert: input.trust_cert,
            };

            let password = input.password.clone().unwrap_or_default();
            postgres::test_connection(&connection, &password).await?;

            let entry_id = id.clone();
            tauri::async_runtime::spawn_blocking(move || {
                keyring_entry(&entry_id)?
                    .set_password(&password)
                    .map_err(|e| format!("Could not store password: {e}"))
            })
            .await
            .map_err(|e| e.to_string())??;
            connection
        }
        other => {
            return Err(format!(
                "Driver '{other}' is not supported yet — SQLite, SQL Server, and PostgreSQL are available."
            ));
        }
    };

    store.add(connection.clone())?;
    if let Err(e) = recents.remember(RecentConnection::from(&connection)) {
        eprintln!("warning: could not save recent connection: {e}");
    }
    Ok(connection)
}

fn default_name(name: &str, fallback: &str) -> String {
    if name.trim().is_empty() {
        fallback.trim().to_string()
    } else {
        name.trim().to_string()
    }
}

#[tauri::command]
fn remove_connection(store: State<ConnectionStore>, id: String) -> Result<(), String> {
    forget_secret(&id);
    store.remove(&id)
}

#[tauri::command]
async fn list_databases(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let connection = store.get(&connection_id).ok_or("Unknown connection.")?;
    match connection.driver.as_str() {
        // A sqlite file is a single database — the UI hides the selector.
        "sqlite" => Ok(Vec::new()),
        "mssql" => {
            let secret = resolve_secret(&app, &connection).await?;
            mssql::list_databases(&connection, secret).await
        }
        "postgres" => {
            let password = stored_password(&connection).await?;
            postgres::list_databases(&connection, &password).await
        }
        other => Err(format!("Driver '{other}' is not supported yet.")),
    }
}

#[tauri::command]
async fn list_tables(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    connection_id: String,
    database: Option<String>,
) -> Result<Vec<TableMeta>, String> {
    let connection = store.get(&connection_id).ok_or("Unknown connection.")?;
    match connection.driver.as_str() {
        "sqlite" => {
            tauri::async_runtime::spawn_blocking(move || sqlite::list_tables(&connection.database))
                .await
                .map_err(|e| e.to_string())?
        }
        "mssql" => {
            let secret = resolve_secret(&app, &connection).await?;
            mssql::list_tables(&connection, secret, database.as_deref()).await
        }
        "postgres" => {
            let password = stored_password(&connection).await?;
            postgres::list_tables(&connection, &password, database.as_deref()).await
        }
        other => Err(format!("Driver '{other}' is not supported yet.")),
    }
}

#[tauri::command]
async fn run_query(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
    connection_id: String,
    sql: String,
    database: Option<String>,
) -> Result<QueryResult, String> {
    let connection = store.get(&connection_id).ok_or("Unknown connection.")?;
    match connection.driver.as_str() {
        "sqlite" => tauri::async_runtime::spawn_blocking(move || {
            sqlite::run_query(&connection.database, &sql)
        })
        .await
        .map_err(|e| e.to_string())?,
        "mssql" => {
            let secret = resolve_secret(&app, &connection).await?;
            mssql::run_query(&connection, secret, database.as_deref(), &sql).await
        }
        "postgres" => {
            let password = stored_password(&connection).await?;
            postgres::run_query(&connection, &password, database.as_deref(), &sql).await
        }
        other => Err(format!("Driver '{other}' is not supported yet.")),
    }
}

#[tauri::command]
async fn export_result(
    path: String,
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || export::export(&path, &columns, &rows))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_demo_database(
    app: tauri::AppHandle,
    store: State<'_, ConnectionStore>,
) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("demo.db");

    let seed_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || sqlite::create_demo_database(&seed_path))
        .await
        .map_err(|e| e.to_string())??;

    let database = path.to_string_lossy().into_owned();
    if let Some(existing) = store.list().into_iter().find(|c| c.database == database) {
        return Ok(existing);
    }
    let connection = Connection {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Demo Database".into(),
        driver: "sqlite".into(),
        host: "local".into(),
        database,
        color: "#4ade80".into(),
        port: None,
        username: None,
        auth: None,
        trust_cert: None,
    };
    store.add(connection.clone())?;
    Ok(connection)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            migrate_legacy_config(&config_dir);
            app.manage(ConnectionStore::load(config_dir.clone()));
            app.manage(RecentStore::load(config_dir));
            app.manage(TokenCache::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_connections,
            list_recent_connections,
            add_connection,
            remove_connection,
            list_databases,
            list_tables,
            run_query,
            export_result,
            create_demo_database
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
