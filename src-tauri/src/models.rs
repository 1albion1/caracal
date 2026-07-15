use serde::{Deserialize, Serialize};

/// Serialized field names are camelCase to match the TypeScript types in src/types.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub driver: String,
    /// Server host; may include a named instance ("server\\SQLEXPRESS").
    /// For sqlite this is just "local".
    pub host: String,
    pub database: String,
    pub color: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    /// "sql" (login+password), "windows" (integrated), or "entra" (Azure AD token).
    #[serde(default)]
    pub auth: Option<String>,
    #[serde(default)]
    pub trust_cert: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMeta {
    pub schema: String,
    pub name: String,
    /// "table" | "partition" | "view" | "materialized_view" | "procedure"
    pub kind: String,
    pub row_count: i64,
    pub columns: Vec<ColumnMeta>,
}

/// One operator in an execution plan tree, for the graphical plan view.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanNode {
    pub label: String,
    pub detail: Option<String>,
    /// Rows produced (actual when available, else estimated).
    pub rows: Option<f64>,
    /// Actual time in ms, inclusive of children (PostgreSQL only).
    pub time_ms: Option<f64>,
    /// Subtree cost (SQL Server / PostgreSQL estimate).
    pub cost: Option<f64>,
    /// All raw per-operator attributes, for the detail panel (ordered key/value).
    pub extra: Vec<(String, String)>,
    /// True when this operator ran across multiple threads/workers.
    pub parallel: bool,
    pub children: Vec<PlanNode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: i64,
    pub duration_ms: u64,
}

/// A connection's settings without id or secrets — remembered so the
/// new-connection dialog can prefill from recently used setups.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentConnection {
    pub name: String,
    pub driver: String,
    pub host: String,
    pub database: String,
    pub color: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub auth: Option<String>,
    #[serde(default)]
    pub trust_cert: Option<bool>,
}

impl From<&Connection> for RecentConnection {
    fn from(c: &Connection) -> Self {
        Self {
            name: c.name.clone(),
            driver: c.driver.clone(),
            host: c.host.clone(),
            database: c.database.clone(),
            color: c.color.clone(),
            port: c.port,
            username: c.username.clone(),
            auth: c.auth.clone(),
            trust_cert: c.trust_cert,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewConnection {
    pub name: String,
    pub driver: String,
    pub database: String,
    pub color: String,
    #[serde(default)]
    pub create_if_missing: bool,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    /// Only transported once at creation; persisted in Windows Credential
    /// Manager, never in the connections file.
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub auth: Option<String>,
    #[serde(default)]
    pub trust_cert: Option<bool>,
}
