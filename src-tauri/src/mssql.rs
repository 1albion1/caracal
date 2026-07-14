use crate::models::{ColumnMeta, Connection, QueryResult, TableMeta};
use futures_util::TryStreamExt;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tiberius::{AuthMethod, Client, ColumnData, ColumnType, Config, FromSql, QueryItem, SqlBrowser};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

/// Same UI cap as the sqlite driver.
const MAX_ROWS: usize = 10_000;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

type MssqlClient = Client<Compat<TcpStream>>;

/// Auth secret resolved before connecting: a stored password for SQL logins,
/// an Azure AD access token for Entra, nothing for Windows integrated auth.
pub enum Secret {
    Password(String),
    AadToken(String),
    None,
}

async fn connect(
    conn: &Connection,
    secret: Secret,
    database: Option<&str>,
) -> Result<MssqlClient, String> {
    let mut config = Config::new();

    let named_instance = conn.host.split_once('\\');
    if let Some((server, instance)) = named_instance {
        config.host(server);
        config.instance_name(instance);
    } else {
        config.host(&conn.host);
        config.port(conn.port.unwrap_or(1433));
    }
    // The selected database wins over the connection default. Connecting
    // directly to the target database (instead of USE) also works on Azure
    // SQL, where cross-database USE is not allowed.
    let database = database
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .or_else(|| Some(conn.database.trim()).filter(|d| !d.is_empty()));
    if let Some(db) = database {
        config.database(db);
    }

    match secret {
        Secret::Password(password) => config.authentication(AuthMethod::sql_server(
            conn.username.clone().unwrap_or_default(),
            password,
        )),
        Secret::AadToken(token) => config.authentication(AuthMethod::aad_token(token)),
        Secret::None => config.authentication(AuthMethod::Integrated),
    }
    if conn.trust_cert.unwrap_or(false) {
        config.trust_cert();
    }

    let connect = async {
        let tcp = if named_instance.is_some() {
            // Named instances resolve their port via the SQL Browser service.
            TcpStream::connect_named(&config)
                .await
                .map_err(|e| format!("Could not reach {}: {e}", conn.host))?
        } else {
            TcpStream::connect(config.get_addr())
                .await
                .map_err(|e| format!("Could not reach {}: {e}", conn.host))?
        };
        tcp.set_nodelay(true).ok();
        Client::connect(config, tcp.compat_write())
            .await
            .map_err(|e| format!("Connection failed: {e}"))
    };
    timeout(CONNECT_TIMEOUT, connect)
        .await
        .map_err(|_| format!("Timed out connecting to {} after 15s.", conn.host))?
}

/// Opens a connection and immediately closes it — used to validate new
/// connections before saving them.
pub async fn test_connection(conn: &Connection, secret: Secret) -> Result<(), String> {
    connect(conn, secret, None).await.map(|_| ())
}

/// All ONLINE databases on the server, user databases first.
pub async fn list_databases(conn: &Connection, secret: Secret) -> Result<Vec<String>, String> {
    let mut client = connect(conn, secret, None).await?;
    let rows = client
        .simple_query(
            "SELECT name FROM sys.databases WHERE state = 0 \
             ORDER BY CASE WHEN database_id <= 4 THEN 1 ELSE 0 END, name",
        )
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| {
            Ok(row
                .try_get::<&str, _>(0)
                .map_err(|e| e.to_string())?
                .unwrap_or_default()
                .to_string())
        })
        .collect()
}

pub async fn list_tables(
    conn: &Connection,
    secret: Secret,
    database: Option<&str>,
) -> Result<Vec<TableMeta>, String> {
    let mut client = connect(conn, secret, database).await?;

    // Tables, views, and stored procedures; approximate row counts from
    // partition metadata (fast even on very large tables; views report 0).
    let tables_sql = "SELECT s.name AS schema_name, o.name AS object_name, o.type, \
         CAST(ISNULL(SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows END), 0) AS bigint) AS row_count \
         FROM sys.objects o \
         JOIN sys.schemas s ON s.schema_id = o.schema_id \
         LEFT JOIN sys.partitions p ON p.object_id = o.object_id \
         WHERE o.type IN ('U', 'V', 'P') \
         GROUP BY s.name, o.name, o.type \
         ORDER BY s.name, o.name";
    let rows = client
        .simple_query(tables_sql)
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut tables: Vec<TableMeta> = rows
        .iter()
        .map(|row| {
            let object_type = row
                .try_get::<&str, _>(2)
                .map_err(|e| e.to_string())?
                .unwrap_or_default()
                .trim()
                .to_string();
            Ok(TableMeta {
                schema: row
                    .try_get::<&str, _>(0)
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default()
                    .to_string(),
                name: row
                    .try_get::<&str, _>(1)
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default()
                    .to_string(),
                kind: match object_type.as_str() {
                    "V" => "view",
                    "P" => "procedure",
                    _ => "table",
                }
                .to_string(),
                row_count: row.try_get::<i64, _>(3).map_err(|e| e.to_string())?.unwrap_or(0),
                columns: Vec::new(),
            })
        })
        .collect::<Result<_, String>>()?;

    let columns_sql = "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, \
         DATA_TYPE + CASE \
           WHEN CHARACTER_MAXIMUM_LENGTH = -1 THEN '(max)' \
           WHEN CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN '(' + CAST(CHARACTER_MAXIMUM_LENGTH AS varchar(10)) + ')' \
           WHEN DATA_TYPE IN ('decimal', 'numeric') THEN '(' + CAST(NUMERIC_PRECISION AS varchar(10)) + ',' + CAST(NUMERIC_SCALE AS varchar(10)) + ')' \
           ELSE '' \
         END AS type_name \
         FROM INFORMATION_SCHEMA.COLUMNS \
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION";
    let rows = client
        .simple_query(columns_sql)
        .await
        .map_err(|e| e.to_string())?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let mut by_table: HashMap<(String, String), Vec<ColumnMeta>> = HashMap::new();
    for row in &rows {
        let schema: &str = row.try_get(0).map_err(|e| e.to_string())?.unwrap_or_default();
        let table: &str = row.try_get(1).map_err(|e| e.to_string())?.unwrap_or_default();
        let column: &str = row.try_get(2).map_err(|e| e.to_string())?.unwrap_or_default();
        let type_name: &str = row.try_get(3).map_err(|e| e.to_string())?.unwrap_or_default();
        by_table
            .entry((schema.to_string(), table.to_string()))
            .or_default()
            .push(ColumnMeta {
                name: column.to_string(),
                data_type: type_name.to_string(),
            });
    }
    for table in &mut tables {
        if let Some(columns) = by_table.remove(&(table.schema.clone(), table.name.clone())) {
            table.columns = columns;
        }
    }
    Ok(tables)
}

pub async fn run_query(
    conn: &Connection,
    secret: Secret,
    database: Option<&str>,
    sql: &str,
) -> Result<QueryResult, String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("Empty query.".into());
    }
    let mut client = connect(conn, secret, database).await?;
    let started = Instant::now();

    // Plain DML/DDL goes through execute() to get an affected-row count;
    // anything that can produce rows streams through simple_query().
    let first_word = trimmed
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase();
    let is_plain_statement = matches!(
        first_word.as_str(),
        "insert" | "update" | "delete" | "merge" | "create" | "alter" | "drop" | "truncate"
            | "grant" | "revoke" | "deny" | "use" | "set"
    );

    if is_plain_statement {
        let result = client.execute(trimmed, &[]).await.map_err(|e| e.to_string())?;
        let affected: u64 = result.rows_affected().iter().sum();
        return Ok(QueryResult {
            columns: vec![ColumnMeta {
                name: "rows_affected".into(),
                data_type: "bigint".into(),
            }],
            rows: vec![vec![serde_json::Value::from(affected)]],
            total_rows: 1,
            duration_ms: started.elapsed().as_millis() as u64,
        });
    }

    let mut stream = client.simple_query(trimmed).await.map_err(|e| e.to_string())?;
    let mut columns: Vec<ColumnMeta> = Vec::new();
    let mut out_rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut total_rows: i64 = 0;

    // Only the first result set is shown; additional sets are drained.
    while let Some(item) = stream.try_next().await.map_err(|e| e.to_string())? {
        match item {
            QueryItem::Metadata(meta) if meta.result_index() == 0 => {
                columns = meta
                    .columns()
                    .iter()
                    .map(|c| ColumnMeta {
                        name: if c.name().is_empty() {
                            "(no name)".into()
                        } else {
                            c.name().to_string()
                        },
                        data_type: column_type_name(c.column_type()).into(),
                    })
                    .collect();
            }
            QueryItem::Row(row) if row.result_index() == 0 => {
                total_rows += 1;
                if out_rows.len() < MAX_ROWS {
                    let mut out = Vec::with_capacity(row.len());
                    for data in row.into_iter() {
                        out.push(cell_to_json(data));
                    }
                    out_rows.push(out);
                }
            }
            _ => {}
        }
    }

    if columns.is_empty() {
        // Batch produced no result set (e.g. DECLARE-only script).
        return Ok(QueryResult {
            columns: vec![ColumnMeta {
                name: "status".into(),
                data_type: "text".into(),
            }],
            rows: vec![vec![serde_json::Value::from("Command completed.")]],
            total_rows: 1,
            duration_ms: started.elapsed().as_millis() as u64,
        });
    }

    Ok(QueryResult {
        columns,
        rows: out_rows,
        total_rows,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

fn cell_to_json(data: ColumnData<'static>) -> serde_json::Value {
    use serde_json::Value;
    match data {
        ColumnData::Bit(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::U8(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::I16(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::I32(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::I64(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::F32(v) => v
            .and_then(|f| serde_json::Number::from_f64(f as f64))
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ColumnData::F64(v) => v
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ColumnData::String(ref v) => v
            .as_ref()
            .map(|s| Value::from(s.to_string()))
            .unwrap_or(Value::Null),
        ColumnData::Guid(v) => v.map(|g| Value::from(g.to_string())).unwrap_or(Value::Null),
        ColumnData::Numeric(v) => v
            .and_then(|n| {
                let scaled = (n.value() as f64) / 10f64.powi(n.scale() as i32);
                serde_json::Number::from_f64(scaled)
            })
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ColumnData::Binary(ref v) => v
            .as_ref()
            .map(|b| {
                let preview: String = b.iter().take(8).map(|byte| format!("{byte:02x}")).collect();
                let ellipsis = if b.len() > 8 { "…" } else { "" };
                Value::from(format!("0x{preview}{ellipsis} ({} bytes)", b.len()))
            })
            .unwrap_or(Value::Null),
        ColumnData::Xml(ref v) => v
            .as_ref()
            .map(|x| Value::from(x.to_string()))
            .unwrap_or(Value::Null),
        ref data @ ColumnData::Date(_) => chrono::NaiveDate::from_sql(data)
            .ok()
            .flatten()
            .map(|d| Value::from(d.format("%Y-%m-%d").to_string()))
            .unwrap_or(Value::Null),
        ref data @ ColumnData::Time(_) => chrono::NaiveTime::from_sql(data)
            .ok()
            .flatten()
            .map(|t| Value::from(t.format("%H:%M:%S%.3f").to_string()))
            .unwrap_or(Value::Null),
        ref data @ (ColumnData::SmallDateTime(_)
        | ColumnData::DateTime(_)
        | ColumnData::DateTime2(_)) => chrono::NaiveDateTime::from_sql(data)
            .ok()
            .flatten()
            .map(|dt| Value::from(dt.format("%Y-%m-%d %H:%M:%S%.3f").to_string()))
            .unwrap_or(Value::Null),
        ref data @ ColumnData::DateTimeOffset(_) => {
            chrono::DateTime::<chrono::Utc>::from_sql(data)
                .ok()
                .flatten()
                .map(|dt| Value::from(dt.format("%Y-%m-%d %H:%M:%S%.3f %z").to_string()))
                .unwrap_or(Value::Null)
        }
    }
}

fn column_type_name(t: ColumnType) -> &'static str {
    match t {
        ColumnType::Null => "",
        ColumnType::Bit | ColumnType::Bitn => "bit",
        ColumnType::Int1 => "tinyint",
        ColumnType::Int2 => "smallint",
        ColumnType::Int4 => "int",
        ColumnType::Int8 | ColumnType::Intn => "bigint",
        ColumnType::Float4 => "real",
        ColumnType::Float8 | ColumnType::Floatn => "float",
        ColumnType::Money | ColumnType::Money4 => "money",
        ColumnType::Decimaln => "decimal",
        ColumnType::Numericn => "numeric",
        ColumnType::Guid => "uniqueidentifier",
        ColumnType::Datetime | ColumnType::Datetimen | ColumnType::Datetime4 => "datetime",
        ColumnType::Daten => "date",
        ColumnType::Timen => "time",
        ColumnType::Datetime2 => "datetime2",
        ColumnType::DatetimeOffsetn => "datetimeoffset",
        ColumnType::BigVarBin => "varbinary",
        ColumnType::BigBinary => "binary",
        ColumnType::BigVarChar => "varchar",
        ColumnType::BigChar => "char",
        ColumnType::NVarchar => "nvarchar",
        ColumnType::NChar => "nchar",
        ColumnType::Xml => "xml",
        ColumnType::Udt => "udt",
        ColumnType::Text => "text",
        ColumnType::NText => "ntext",
        ColumnType::Image => "image",
        ColumnType::SSVariant => "sql_variant",
    }
}
