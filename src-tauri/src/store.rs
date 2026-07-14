use crate::models::{Connection, RecentConnection};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_RECENTS: usize = 10;

/// History of connection setups (no secrets), kept even after a connection
/// is removed, so the new-connection dialog can prefill recent entries.
pub struct RecentStore {
    path: PathBuf,
    items: Mutex<Vec<RecentConnection>>,
}

impl RecentStore {
    pub fn load(config_dir: PathBuf) -> Self {
        let path = config_dir.join("recent_connections.json");
        let items = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            items: Mutex::new(items),
        }
    }

    pub fn list(&self) -> Vec<RecentConnection> {
        self.items.lock().unwrap().clone()
    }

    /// Moves (or inserts) the entry to the front, deduplicated by target.
    pub fn remember(&self, item: RecentConnection) -> Result<(), String> {
        let mut items = self.items.lock().unwrap();
        items.retain(|r| {
            !(r.driver == item.driver
                && r.host == item.host
                && r.database == item.database
                && r.username == item.username
                && r.auth == item.auth)
        });
        items.insert(0, item);
        items.truncate(MAX_RECENTS);
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&*items).map_err(|e| e.to_string())?;
        fs::write(&self.path, json).map_err(|e| e.to_string())
    }
}

/// Saved connections, persisted as JSON in the app config directory so they
/// survive restarts. All mutations write through to disk immediately.
pub struct ConnectionStore {
    path: PathBuf,
    connections: Mutex<Vec<Connection>>,
}

impl ConnectionStore {
    pub fn load(config_dir: PathBuf) -> Self {
        let path = config_dir.join("connections.json");
        let connections = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            connections: Mutex::new(connections),
        }
    }

    pub fn list(&self) -> Vec<Connection> {
        self.connections.lock().unwrap().clone()
    }

    pub fn get(&self, id: &str) -> Option<Connection> {
        self.connections
            .lock()
            .unwrap()
            .iter()
            .find(|c| c.id == id)
            .cloned()
    }

    pub fn add(&self, connection: Connection) -> Result<(), String> {
        let mut list = self.connections.lock().unwrap();
        list.push(connection);
        self.persist(&list)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut list = self.connections.lock().unwrap();
        list.retain(|c| c.id != id);
        self.persist(&list)
    }

    fn persist(&self, list: &[Connection]) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)
                .map_err(|e| format!("Could not create config directory: {e}"))?;
        }
        let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
        fs::write(&self.path, json).map_err(|e| format!("Could not save connections: {e}"))
    }
}
