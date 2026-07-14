use crate::models::{ColumnMeta, QueryResult, TableMeta};
use rusqlite::types::ValueRef;
use rusqlite::{Connection as SqliteConnection, OpenFlags};
use serde_json::Value;
use std::path::Path;
use std::time::Instant;

/// Rows sent to the UI are capped so a `SELECT *` on a huge table cannot
/// freeze the app; the remainder is still counted for the status bar.
const MAX_ROWS: usize = 10_000;

pub fn open(path: &str, create: bool) -> Result<SqliteConnection, String> {
    if !create && !Path::new(path).exists() {
        return Err(format!("Database file not found: {path}"));
    }
    let flags = if create {
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
    } else {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    };
    SqliteConnection::open_with_flags(path, flags)
        .map_err(|e| format!("Could not open database: {e}"))
}

fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub fn list_tables(path: &str) -> Result<Vec<TableMeta>, String> {
    let conn = open(path, false)?;
    let mut stmt = conn
        .prepare(
            "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .map_err(|e| e.to_string())?;
    let names: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let mut tables = Vec::with_capacity(names.len());
    for (name, object_type) in names {
        let columns = table_columns(&conn, &name)?;
        let row_count = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {}", quote_ident(&name)),
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        tables.push(TableMeta {
            schema: "main".into(),
            name,
            kind: if object_type == "view" { "view" } else { "table" }.into(),
            row_count,
            columns,
        });
    }
    Ok(tables)
}

fn table_columns(conn: &SqliteConnection, table: &str) -> Result<Vec<ColumnMeta>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", quote_ident(table)))
        .map_err(|e| e.to_string())?;
    let columns = stmt
        .query_map([], |row| {
            Ok(ColumnMeta {
                name: row.get(1)?,
                data_type: row
                    .get::<_, Option<String>>(2)?
                    .unwrap_or_default()
                    .to_lowercase(),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(columns)
}

pub fn run_query(path: &str, sql: &str) -> Result<QueryResult, String> {
    let conn = open(path, false)?;
    let started = Instant::now();
    let trimmed = sql.trim().trim_end_matches(';');
    if trimmed.is_empty() {
        return Err("Empty query.".into());
    }

    let mut stmt = conn.prepare(trimmed).map_err(|e| e.to_string())?;

    // DDL / DML — no result set, report affected rows instead.
    if stmt.column_count() == 0 {
        let affected = stmt.execute([]).map_err(|e| e.to_string())?;
        return Ok(QueryResult {
            columns: vec![ColumnMeta {
                name: "rows_affected".into(),
                data_type: "int".into(),
            }],
            rows: vec![vec![Value::from(affected as i64)]],
            total_rows: 1,
            duration_ms: started.elapsed().as_millis() as u64,
        });
    }

    let column_count = stmt.column_count();
    let column_names: Vec<String> = (0..column_count)
        .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
        .collect();
    // SQLite is dynamically typed; the column type is inferred from the first
    // non-null value seen in each column.
    let mut column_types: Vec<Option<&'static str>> = vec![None; column_count];

    let mut out_rows: Vec<Vec<Value>> = Vec::new();
    let mut total_rows: i64 = 0;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        total_rows += 1;
        if out_rows.len() >= MAX_ROWS {
            continue; // keep counting for totalRows, stop materializing
        }
        let mut out = Vec::with_capacity(column_count);
        for i in 0..column_count {
            let value = row.get_ref(i).map_err(|e| e.to_string())?;
            if column_types[i].is_none() {
                column_types[i] = type_name(&value);
            }
            out.push(cell_to_json(value));
        }
        out_rows.push(out);
    }

    let columns = column_names
        .into_iter()
        .zip(column_types)
        .map(|(name, data_type)| ColumnMeta {
            name,
            data_type: data_type.unwrap_or("").into(),
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows: out_rows,
        total_rows,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

fn type_name(value: &ValueRef<'_>) -> Option<&'static str> {
    match value {
        ValueRef::Null => None,
        ValueRef::Integer(_) => Some("integer"),
        ValueRef::Real(_) => Some("real"),
        ValueRef::Text(_) => Some("text"),
        ValueRef::Blob(_) => Some("blob"),
    }
}

fn cell_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            let preview: String = b.iter().take(8).map(|byte| format!("{byte:02x}")).collect();
            let ellipsis = if b.len() > 8 { "…" } else { "" };
            Value::from(format!("0x{preview}{ellipsis} ({} bytes)", b.len()))
        }
    }
}

/// Creates (or refills, if empty) a small demo database so the app is usable
/// on first launch without pointing it at an existing file.
pub fn create_demo_database(path: &Path) -> Result<(), String> {
    let conn = open(&path.to_string_lossy(), true)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            city TEXT NOT NULL,
            email TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY,
            sku TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            stock INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY,
            customer_id INTEGER NOT NULL REFERENCES customers(id),
            product_id INTEGER NOT NULL REFERENCES products(id),
            quantity INTEGER NOT NULL,
            status TEXT NOT NULL,
            total REAL NOT NULL,
            ordered_at TEXT NOT NULL,
            note TEXT
        );",
    )
    .map_err(|e| e.to_string())?;

    let existing: i64 = conn
        .query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if existing > 0 {
        return Ok(()); // already seeded
    }

    const FIRST: [&str; 10] = [
        "Anna", "Ben", "Clara", "David", "Elena", "Farid", "Greta", "Hugo", "Ines", "Jonas",
    ];
    const LAST: [&str; 8] = [
        "Meyer", "Schmidt", "Novak", "Berger", "Klein", "Wagner", "Fischer", "Weber",
    ];
    const CITIES: [&str; 8] = [
        "Hamburg", "Berlin", "Munich", "Rotterdam", "Vienna", "Zurich", "Copenhagen", "Gdansk",
    ];
    const STATUSES: [&str; 5] = ["open", "processing", "shipped", "delivered", "cancelled"];
    const PRODUCTS: [&str; 7] = [
        "Pallet Jack", "Forklift Filter", "Dock Bumper", "Roller Door", "Sensor Kit",
        "Dock Leveler", "Seal Strip",
    ];

    // Deterministic LCG so the demo data is the same on every machine.
    let mut seed: u64 = 0x5DEECE66D;
    let mut next = move |max: u64| -> u64 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) % max
    };

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut ins = tx
            .prepare("INSERT INTO customers (name, city, email, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
            .map_err(|e| e.to_string())?;
        for _ in 0..500 {
            let first = FIRST[next(10) as usize];
            let last = LAST[next(8) as usize];
            let name = format!("{first} {last}");
            let email = format!("{}.{}@example.com", first.to_lowercase(), last.to_lowercase());
            let date = format!("2026-{:02}-{:02}", 1 + next(12), 1 + next(28));
            ins.execute(rusqlite::params![
                name,
                CITIES[next(8) as usize],
                email,
                (next(10) > 1) as i64,
                date
            ])
            .map_err(|e| e.to_string())?;
        }

        let mut ins = tx
            .prepare("INSERT INTO products (sku, name, price, stock) VALUES (?1, ?2, ?3, ?4)")
            .map_err(|e| e.to_string())?;
        for i in 0..120 {
            ins.execute(rusqlite::params![
                format!("SKU-{:05}", i + 1),
                format!("{} {}", PRODUCTS[next(7) as usize], 1 + next(9)),
                (next(20000) as f64) / 100.0,
                next(800) as i64
            ])
            .map_err(|e| e.to_string())?;
        }

        let mut ins = tx
            .prepare("INSERT INTO orders (customer_id, product_id, quantity, status, total, ordered_at, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
            .map_err(|e| e.to_string())?;
        for _ in 0..5000 {
            let quantity = 1 + next(20) as i64;
            let unit_price = (next(20000) as f64) / 100.0;
            let date = format!("2026-{:02}-{:02}", 1 + next(12), 1 + next(28));
            let note: Option<&str> = if next(10) > 7 { Some("expedite") } else { None };
            ins.execute(rusqlite::params![
                1 + next(500) as i64,
                1 + next(120) as i64,
                quantity,
                STATUSES[next(5) as usize],
                (quantity as f64) * unit_price,
                date,
                note
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("dbms-test-{}-{name}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn demo_database_roundtrip() {
        let path = temp_db("roundtrip");
        create_demo_database(&path).expect("seed demo db");
        let path_str = path.to_string_lossy();

        // Introspection sees the three seeded tables with row counts.
        let tables = list_tables(&path_str).expect("list tables");
        let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["customers", "orders", "products"]);
        let orders = tables.iter().find(|t| t.name == "orders").unwrap();
        assert_eq!(orders.row_count, 5000);
        assert!(orders.columns.iter().any(|c| c.name == "status"));

        let result = run_query(&path_str, "SELECT * FROM orders LIMIT 10;").expect("select");
        assert_eq!(result.rows.len(), 10);
        assert_eq!(result.total_rows, 10);
        assert_eq!(result.columns.len(), 8);

        // Results larger than MAX_ROWS are truncated but fully counted.
        let result = run_query(
            &path_str,
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 25000) \
             SELECT x FROM n",
        )
        .expect("big select");
        assert_eq!(result.rows.len(), MAX_ROWS);
        assert_eq!(result.total_rows, 25000);

        // DML returns affected-row count instead of a result set.
        let result =
            run_query(&path_str, "UPDATE orders SET note = 'x' WHERE id <= 3").expect("update");
        assert_eq!(result.columns[0].name, "rows_affected");
        assert_eq!(result.rows[0][0], serde_json::json!(3));

        // Seeding twice must not duplicate data.
        create_demo_database(&path).expect("re-seed");
        let result = run_query(&path_str, "SELECT COUNT(*) AS n FROM customers").expect("count");
        assert_eq!(result.rows[0][0], serde_json::json!(500));

        // Errors surface as messages, not panics.
        assert!(run_query(&path_str, "SELECT * FROM missing_table").is_err());
        assert!(run_query(&path_str, "   ").is_err());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn open_missing_file_fails_without_create() {
        let path = temp_db("missing");
        assert!(open(&path.to_string_lossy(), false).is_err());
    }
}
