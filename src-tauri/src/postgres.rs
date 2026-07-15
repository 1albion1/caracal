use crate::models::{ColumnMeta, Connection, PlanNode, QueryResult, TableMeta};
use serde_json::Value;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::time::timeout;
use tokio_postgres::{Client, SimpleQueryMessage};

/// Same UI cap as the other drivers.
const MAX_ROWS: usize = 10_000;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

async fn connect(
    conn: &Connection,
    password: &str,
    database: Option<&str>,
) -> Result<Client, String> {
    let mut config = tokio_postgres::Config::new();
    config.host(&conn.host);
    config.port(conn.port.unwrap_or(5432));
    config.user(conn.username.as_deref().unwrap_or("postgres"));
    config.password(password);
    config.connect_timeout(CONNECT_TIMEOUT);
    // The selected database wins over the connection default; postgres
    // requires connecting to SOME database, so fall back to "postgres".
    let database = database
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .or_else(|| Some(conn.database.trim()).filter(|d| !d.is_empty()))
        .unwrap_or("postgres");
    config.dbname(database);

    // TLS is attempted and falls back to plaintext if the server has none
    // (tokio-postgres "prefer" mode); trust_cert accepts self-signed certs.
    let tls = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(conn.trust_cert.unwrap_or(false))
        .build()
        .map_err(|e| e.to_string())?;
    let tls = postgres_native_tls::MakeTlsConnector::new(tls);

    let (client, connection) = timeout(CONNECT_TIMEOUT, config.connect(tls))
        .await
        .map_err(|_| format!("Timed out connecting to {} after 15s.", conn.host))?
        .map_err(|e| format!("Connection failed: {e}"))?;
    // The connection object drives the socket; it lives as long as the client.
    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });
    Ok(client)
}

pub async fn test_connection(conn: &Connection, password: &str) -> Result<(), String> {
    connect(conn, password, None).await.map(|_| ())
}

/// All connectable, non-template databases; "postgres" sorted last.
pub async fn list_databases(conn: &Connection, password: &str) -> Result<Vec<String>, String> {
    let client = connect(conn, password, None).await?;
    let messages = client
        .simple_query(
            "SELECT datname FROM pg_database \
             WHERE NOT datistemplate AND datallowconn \
             ORDER BY (datname = 'postgres')::int, datname",
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(messages
        .into_iter()
        .filter_map(|msg| match msg {
            SimpleQueryMessage::Row(row) => row.get(0).map(str::to_string),
            _ => None,
        })
        .collect())
}

pub async fn list_tables(
    conn: &Connection,
    password: &str,
    database: Option<&str>,
) -> Result<Vec<TableMeta>, String> {
    let client = connect(conn, password, database).await?;

    // Tables, child partitions, views, and materialized views with planner
    // row estimates (instant even on huge tables; -1 = never analyzed).
    let messages = client
        .simple_query(
            "SELECT n.nspname, c.relname, \
             CASE WHEN c.relispartition THEN 'partition' \
                  WHEN c.relkind = 'v' THEN 'view' \
                  WHEN c.relkind = 'm' THEN 'materialized_view' \
                  ELSE 'table' END, \
             GREATEST(c.reltuples, 0)::bigint \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE c.relkind IN ('r', 'p', 'v', 'm') \
               AND n.nspname NOT IN ('pg_catalog', 'information_schema') \
               AND n.nspname NOT LIKE 'pg_toast%' \
             ORDER BY n.nspname, c.relname",
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut tables: Vec<TableMeta> = messages
        .into_iter()
        .filter_map(|msg| match msg {
            SimpleQueryMessage::Row(row) => Some(TableMeta {
                schema: row.get(0).unwrap_or_default().to_string(),
                name: row.get(1).unwrap_or_default().to_string(),
                kind: row.get(2).unwrap_or("table").to_string(),
                row_count: row.get(3).and_then(|v| v.parse().ok()).unwrap_or(0),
                columns: Vec::new(),
            }),
            _ => None,
        })
        .collect();

    // Stored procedures (prokind 'p'; plain functions are not listed yet).
    let messages = client
        .simple_query(
            "SELECT n.nspname, p.proname \
             FROM pg_proc p \
             JOIN pg_namespace n ON n.oid = p.pronamespace \
             WHERE p.prokind = 'p' \
               AND n.nspname NOT IN ('pg_catalog', 'information_schema') \
             ORDER BY n.nspname, p.proname",
        )
        .await
        .map_err(|e| e.to_string())?;
    tables.extend(messages.into_iter().filter_map(|msg| match msg {
        SimpleQueryMessage::Row(row) => Some(TableMeta {
            schema: row.get(0).unwrap_or_default().to_string(),
            name: row.get(1).unwrap_or_default().to_string(),
            kind: "procedure".to_string(),
            row_count: 0,
            columns: Vec::new(),
        }),
        _ => None,
    }));

    let messages = client
        .simple_query(
            "SELECT table_schema, table_name, column_name, \
             data_type || CASE \
               WHEN character_maximum_length IS NOT NULL \
                 THEN '(' || character_maximum_length || ')' \
               WHEN data_type IN ('numeric', 'decimal') AND numeric_precision IS NOT NULL \
                 THEN '(' || numeric_precision || ',' || COALESCE(numeric_scale, 0) || ')' \
               ELSE '' \
             END \
             FROM information_schema.columns \
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema') \
             ORDER BY table_schema, table_name, ordinal_position",
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut by_table: HashMap<(String, String), Vec<ColumnMeta>> = HashMap::new();
    for msg in messages {
        if let SimpleQueryMessage::Row(row) = msg {
            by_table
                .entry((
                    row.get(0).unwrap_or_default().to_string(),
                    row.get(1).unwrap_or_default().to_string(),
                ))
                .or_default()
                .push(ColumnMeta {
                    name: row.get(2).unwrap_or_default().to_string(),
                    data_type: row.get(3).unwrap_or_default().to_string(),
                });
        }
    }
    for table in &mut tables {
        if let Some(columns) = by_table.remove(&(table.schema.clone(), table.name.clone())) {
            table.columns = columns;
        }
    }
    Ok(tables)
}

/// Estimated execution plan via EXPLAIN — planner only, does not execute the
/// statement, so it is safe on any query. Rows come back under "QUERY PLAN".
pub async fn explain(
    conn: &Connection,
    password: &str,
    database: Option<&str>,
    sql: &str,
) -> Result<QueryResult, String> {
    let trimmed = sql.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return Err("Empty query.".into());
    }
    run_query(conn, password, database, &format!("EXPLAIN {trimmed}")).await
}

/// Actual execution plan as a tree via EXPLAIN (ANALYZE, FORMAT JSON) — EXECUTES
/// the query and captures real per-node timing and row counts.
pub async fn analyze_plan(
    conn: &Connection,
    password: &str,
    database: Option<&str>,
    sql: &str,
) -> Result<PlanNode, String> {
    let trimmed = sql.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return Err("Empty query.".into());
    }
    let result = run_query(
        conn,
        password,
        database,
        &format!("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {trimmed}"),
    )
    .await?;
    let text = result
        .rows
        .first()
        .and_then(|r| r.first())
        .and_then(|v| v.as_str())
        .ok_or("No plan returned.")?;
    let parsed: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("Could not parse plan: {e}"))?;
    let plan = parsed
        .get(0)
        .and_then(|o| o.get("Plan"))
        .ok_or("Plan tree missing from EXPLAIN output.")?;
    Ok(pg_plan_node(plan))
}

fn pg_plan_node(v: &serde_json::Value) -> PlanNode {
    let node_type = v.get("Node Type").and_then(|x| x.as_str()).unwrap_or("?");
    let mut label = node_type.to_string();
    if let Some(rel) = v.get("Relation Name").and_then(|x| x.as_str()) {
        label = format!("{node_type} on {rel}");
    }
    if let Some(idx) = v.get("Index Name").and_then(|x| x.as_str()) {
        label = format!("{label} using {idx}");
    }
    let loops = v.get("Actual Loops").and_then(|x| x.as_f64()).unwrap_or(1.0);
    let time_ms = v
        .get("Actual Total Time")
        .and_then(|x| x.as_f64())
        .map(|t| t * loops);
    let rows = v
        .get("Actual Rows")
        .and_then(|x| x.as_f64())
        .map(|r| r * loops)
        .or_else(|| v.get("Plan Rows").and_then(|x| x.as_f64()));
    let cost = v.get("Total Cost").and_then(|x| x.as_f64());
    let detail = [
        "Index Cond", "Filter", "Hash Cond", "Join Filter", "Recheck Cond", "Sort Key",
    ]
    .iter()
    .find_map(|k| {
        v.get(*k).and_then(|x| x.as_str()).map(|s| format!("{k}: {s}"))
    });
    // Everything the planner reported for this node (minus the child array).
    let mut extra: Vec<(String, String)> = Vec::new();
    if let Some(obj) = v.as_object() {
        for (k, val) in obj {
            if k == "Plans" {
                continue;
            }
            let s = match val {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::Bool(b) => b.to_string(),
                _ => continue,
            };
            extra.push((k.clone(), s));
        }
    }
    let parallel = v.get("Parallel Aware").and_then(|x| x.as_bool()).unwrap_or(false)
        || v.get("Workers Planned").and_then(|x| x.as_f64()).unwrap_or(0.0) > 0.0
        || v.get("Workers Launched").and_then(|x| x.as_f64()).unwrap_or(0.0) > 0.0;
    let children = v
        .get("Plans")
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().map(pg_plan_node).collect())
        .unwrap_or_default();
    PlanNode {
        label,
        detail,
        rows,
        time_ms,
        cost,
        extra,
        parallel,
        children,
    }
}

pub async fn run_query(
    conn: &Connection,
    password: &str,
    database: Option<&str>,
    sql: &str,
) -> Result<QueryResult, String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("Empty query.".into());
    }
    let client = connect(conn, password, database).await?;
    let started = Instant::now();

    // The simple query protocol returns every value as text and supports
    // multi-statement scripts natively; only the first result set is shown.
    let messages = client
        .simple_query(trimmed)
        .await
        .map_err(|e| e.to_string())?;

    let mut columns: Vec<ColumnMeta> = Vec::new();
    let mut out_rows: Vec<Vec<Value>> = Vec::new();
    let mut total_rows: i64 = 0;
    let mut affected: Option<u64> = None;
    let mut first_set_done = false;

    for msg in messages {
        match msg {
            SimpleQueryMessage::RowDescription(desc) => {
                if columns.is_empty() && !first_set_done {
                    columns = desc
                        .iter()
                        .map(|c| ColumnMeta {
                            name: c.name().to_string(),
                            data_type: String::new(),
                        })
                        .collect();
                } else {
                    first_set_done = true;
                }
            }
            SimpleQueryMessage::Row(row) => {
                if first_set_done {
                    continue;
                }
                if columns.is_empty() {
                    columns = row
                        .columns()
                        .iter()
                        .map(|c| ColumnMeta {
                            name: c.name().to_string(),
                            data_type: String::new(),
                        })
                        .collect();
                }
                total_rows += 1;
                if out_rows.len() < MAX_ROWS {
                    out_rows.push(
                        (0..row.len())
                            .map(|i| row.get(i).map(Value::from).unwrap_or(Value::Null))
                            .collect(),
                    );
                }
            }
            SimpleQueryMessage::CommandComplete(n) => {
                if affected.is_none() {
                    affected = Some(n);
                }
                if !columns.is_empty() {
                    first_set_done = true;
                }
            }
            _ => {}
        }
    }

    if columns.is_empty() {
        // DML / DDL — report affected rows instead of a result set.
        return Ok(QueryResult {
            columns: vec![ColumnMeta {
                name: "rows_affected".into(),
                data_type: "bigint".into(),
            }],
            rows: vec![vec![Value::from(affected.unwrap_or(0))]],
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
