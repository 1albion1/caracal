use serde_json::Value;
use std::io::Write;

/// Writes the result set to `path`; the format is chosen by extension
/// (.xlsx, .json, anything else = CSV). Returns the number of data rows.
pub fn export(path: &str, columns: &[String], rows: &[Vec<Value>]) -> Result<usize, String> {
    let lower = path.to_lowercase();
    if lower.ends_with(".xlsx") {
        write_xlsx(path, columns, rows)
    } else if lower.ends_with(".json") {
        write_json(path, columns, rows)
    } else {
        write_csv(path, columns, rows)
    }
}

fn write_csv(path: &str, columns: &[String], rows: &[Vec<Value>]) -> Result<usize, String> {
    let file = std::fs::File::create(path).map_err(|e| format!("Could not create file: {e}"))?;
    let mut out = std::io::BufWriter::new(file);
    // UTF-8 BOM so Excel detects the encoding instead of mangling umlauts.
    out.write_all(b"\xEF\xBB\xBF").map_err(|e| e.to_string())?;

    let header: Vec<String> = columns.iter().map(|c| csv_field(c)).collect();
    writeln!(out, "{}", header.join(",")).map_err(|e| e.to_string())?;
    for row in rows {
        let line: Vec<String> = row.iter().map(csv_value).collect();
        writeln!(out, "{}", line.join(",")).map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())?;
    Ok(rows.len())
}

fn csv_value(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => csv_field(s),
        other => csv_field(&other.to_string()),
    }
}

fn csv_field(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

fn write_xlsx(path: &str, columns: &[String], rows: &[Vec<Value>]) -> Result<usize, String> {
    use rust_xlsxwriter::{Format, Workbook};

    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    let bold = Format::new().set_bold();

    for (c, name) in columns.iter().enumerate() {
        sheet
            .write_with_format(0, c as u16, name.as_str(), &bold)
            .map_err(|e| e.to_string())?;
    }
    for (r, row) in rows.iter().enumerate() {
        let r = (r + 1) as u32;
        for (c, value) in row.iter().enumerate() {
            let c = c as u16;
            match value {
                Value::Null => {}
                Value::Bool(b) => {
                    sheet.write(r, c, *b).map_err(|e| e.to_string())?;
                }
                Value::Number(n) => {
                    sheet
                        .write(r, c, n.as_f64().unwrap_or(0.0))
                        .map_err(|e| e.to_string())?;
                }
                Value::String(s) => {
                    sheet.write(r, c, s.as_str()).map_err(|e| e.to_string())?;
                }
                other => {
                    sheet
                        .write(r, c, other.to_string())
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    workbook
        .save(path)
        .map_err(|e| format!("Could not save workbook: {e}"))?;
    Ok(rows.len())
}

fn write_json(path: &str, columns: &[String], rows: &[Vec<Value>]) -> Result<usize, String> {
    // Array of objects; keys follow the result's column order.
    let objects: Vec<serde_json::Map<String, Value>> = rows
        .iter()
        .map(|row| {
            columns
                .iter()
                .cloned()
                .zip(row.iter().cloned())
                .collect()
        })
        .collect();
    let json = serde_json::to_string_pretty(&objects).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("Could not create file: {e}"))?;
    Ok(rows.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> (Vec<String>, Vec<Vec<Value>>) {
        (
            vec!["id".into(), "name".into(), "note".into()],
            vec![
                vec![json!(1), json!("plain"), json!(null)],
                vec![json!(2.5), json!("has, comma \"quoted\""), json!(true)],
            ],
        )
    }

    #[test]
    fn csv_roundtrip_with_escaping() {
        let path = std::env::temp_dir().join(format!("caracal-export-{}.csv", std::process::id()));
        let (columns, rows) = sample();
        assert_eq!(export(&path.to_string_lossy(), &columns, &rows).unwrap(), 2);
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("id,name,note"));
        assert!(content.contains("\"has, comma \"\"quoted\"\"\""));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn xlsx_and_json_write() {
        let (columns, rows) = sample();
        for ext in ["xlsx", "json"] {
            let path = std::env::temp_dir()
                .join(format!("caracal-export-{}.{ext}", std::process::id()));
            assert_eq!(export(&path.to_string_lossy(), &columns, &rows).unwrap(), 2);
            assert!(std::fs::metadata(&path).unwrap().len() > 0);
            let _ = std::fs::remove_file(&path);
        }
    }
}
