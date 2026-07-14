import { open, save } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri, provider } from "../data";
import type { AuthMethod, Driver, NewConnectionInput, RecentConnection } from "../types";

const COLORS = ["#4ade80", "#60a5fa", "#facc15", "#f87171", "#c084fc", "#fb923c"];

const DRIVERS: { value: Driver; label: string; enabled: boolean }[] = [
  { value: "mssql", label: "SQL Server / Azure SQL", enabled: true },
  { value: "postgres", label: "PostgreSQL", enabled: true },
  { value: "sqlite", label: "SQLite", enabled: true },
  { value: "mysql", label: "MySQL (soon)", enabled: false },
];

const DEFAULT_PORTS: Partial<Record<Driver, string>> = { mssql: "1433", postgres: "5432" };

const AUTH_METHODS: { value: AuthMethod; label: string }[] = [
  { value: "sql", label: "SQL Server Authentication" },
  { value: "windows", label: "Windows Authentication" },
  { value: "entra", label: "Microsoft Entra ID (browser sign-in)" },
];

const FILE_FILTERS = [
  { name: "SQLite database", extensions: ["db", "sqlite", "sqlite3", "db3"] },
  { name: "All files", extensions: ["*"] },
];

interface ConnectionDialogProps {
  onSubmit(input: NewConnectionInput): Promise<void>;
  onClose(): void;
}

export function ConnectionDialog({ onSubmit, onClose }: ConnectionDialogProps) {
  const [driver, setDriver] = useState<Driver>("mssql");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("1433");
  const [database, setDatabase] = useState("");
  const [auth, setAuth] = useState<AuthMethod>("sql");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [trustCert, setTrustCert] = useState(true);
  const [color, setColor] = useState(COLORS[0]);
  const [createIfMissing, setCreateIfMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentConnection[]>([]);

  useEffect(() => {
    provider.listRecentConnections().then(setRecents).catch(() => {});
  }, []);

  /** Prefills every field from a recent setup; only a password must be re-entered. */
  function applyRecent(recent: RecentConnection) {
    setDriver(recent.driver);
    setName(recent.name);
    setHost(recent.host === "local" ? "" : recent.host);
    setPort(recent.port ? String(recent.port) : "1433");
    setDatabase(recent.database);
    setAuth(recent.auth ?? "sql");
    setUsername(recent.username ?? "");
    setPassword("");
    setTrustCert(recent.trustCert ?? true);
    setColor(recent.color);
    setCreateIfMissing(false);
    setError(null);
  }

  function recentLabel(recent: RecentConnection): string {
    const target =
      recent.driver === "sqlite"
        ? recent.database
        : `${recent.host}${recent.database ? `/${recent.database}` : ""}`;
    return `${recent.name} — ${target}`;
  }

  const isServer = driver === "mssql" || driver === "postgres";
  // Named instances and auth-method choice are SQL Server concepts;
  // postgres always authenticates with username + password.
  const hasInstance = driver === "mssql" && host.includes("\\");
  const effectiveAuth: AuthMethod = driver === "postgres" ? "sql" : auth;
  const canSubmit = isServer
    ? host.trim() !== "" && (effectiveAuth !== "sql" || username.trim() !== "")
    : database.trim() !== "";

  function changeDriver(next: Driver) {
    setDriver(next);
    setPort(DEFAULT_PORTS[next] ?? "");
    setError(null);
  }

  async function browse() {
    // A new database uses a save dialog (pick a location), an existing one an open dialog.
    const picked = createIfMissing
      ? await save({ filters: FILE_FILTERS, defaultPath: "new-database.db" })
      : await open({ filters: FILE_FILTERS, multiple: false });
    if (typeof picked === "string") setDatabase(picked);
  }

  async function submit() {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const defaultPort = driver === "postgres" ? 5432 : 1433;
      const input: NewConnectionInput = isServer
        ? {
            name,
            driver,
            database: database.trim(),
            color,
            createIfMissing: false,
            host: host.trim(),
            port: hasInstance ? undefined : parseInt(port, 10) || defaultPort,
            auth: effectiveAuth,
            username: effectiveAuth === "sql" ? username.trim() : undefined,
            password: effectiveAuth === "sql" ? password : undefined,
            trustCert,
          }
        : { name, driver, database, color, createIfMissing };
      await onSubmit(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="New connection">
        <div className="modal-title">New connection</div>

        {recents.length > 0 && (
          <>
            <label className="form-label" htmlFor="conn-recent">Recent</label>
            <select
              id="conn-recent"
              className="form-input"
              value=""
              onChange={(e) => {
                const recent = recents[parseInt(e.target.value, 10)];
                if (recent) applyRecent(recent);
              }}
            >
              <option value="">Fill from a recent connection…</option>
              {recents.map((recent, index) => (
                <option key={index} value={index}>
                  {recentLabel(recent)}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="form-label" htmlFor="conn-driver">Driver</label>
        <select
          id="conn-driver"
          className="form-input"
          value={driver}
          onChange={(e) => changeDriver(e.target.value as Driver)}
        >
          {DRIVERS.map((d) => (
            <option key={d.value} value={d.value} disabled={!d.enabled}>
              {d.label}
            </option>
          ))}
        </select>

        <label className="form-label" htmlFor="conn-name">Name</label>
        <input
          id="conn-name"
          className="form-input"
          placeholder={isServer ? "My Server" : "My Database"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        {isServer ? (
          <>
            <div className="form-two-col">
              <div>
                <label className="form-label" htmlFor="conn-host">Server</label>
                <input
                  id="conn-host"
                  className="form-input"
                  placeholder={
                    driver === "postgres"
                      ? "localhost or db.example.com"
                      : "localhost\\SQLEXPRESS or myserver.database.windows.net"
                  }
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>
              <div className="form-port">
                <label className="form-label" htmlFor="conn-port">Port</label>
                <input
                  id="conn-port"
                  className="form-input"
                  value={hasInstance ? "" : port}
                  placeholder={hasInstance ? "auto" : "1433"}
                  disabled={hasInstance}
                  onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                  title={hasInstance ? "Named instances resolve their port via SQL Browser" : ""}
                />
              </div>
            </div>

            <label className="form-label" htmlFor="conn-db">Database (optional)</label>
            <input
              id="conn-db"
              className="form-input"
              placeholder={driver === "postgres" ? "postgres" : "master"}
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
            />

            {driver === "mssql" && (
              <>
                <label className="form-label" htmlFor="conn-auth">Authentication</label>
                <select
                  id="conn-auth"
                  className="form-input"
                  value={auth}
                  onChange={(e) => setAuth(e.target.value as AuthMethod)}
                >
                  {AUTH_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            {effectiveAuth === "sql" && (
              <>
                <label className="form-label" htmlFor="conn-user">Login</label>
                <input
                  id="conn-user"
                  className="form-input"
                  placeholder={driver === "postgres" ? "postgres" : "sa"}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <label className="form-label" htmlFor="conn-pass">Password</label>
                <input
                  id="conn-pass"
                  className="form-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
                <div className="form-hint">
                  Stored in the Windows Credential Manager, not in a config file.
                </div>
              </>
            )}
            {driver === "mssql" && auth === "entra" && (
              <div className="form-hint">
                Your browser opens to sign in with your Microsoft account — like SSMS.
                You stay signed in afterwards; no Azure CLI needed.
              </div>
            )}

            <label className="form-check">
              <input
                type="checkbox"
                checked={trustCert}
                onChange={(e) => setTrustCert(e.target.checked)}
              />
              Trust server certificate (needed for local servers without a CA cert)
            </label>
          </>
        ) : (
          <>
            <label className="form-label" htmlFor="conn-file">Database file</label>
            <div className="form-file-row">
              <input
                id="conn-file"
                className="form-input"
                placeholder="C:\path\to\database.db"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              {isTauri && (
                <button className="btn" onClick={browse} title="Browse…">
                  <FolderOpen size={14} />
                </button>
              )}
            </div>

            <label className="form-check">
              <input
                type="checkbox"
                checked={createIfMissing}
                onChange={(e) => setCreateIfMissing(e.target.checked)}
              />
              Create a new database file if it does not exist
            </label>
          </>
        )}

        <div className="form-label">Color</div>
        <div className="color-swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color ? "selected" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !canSubmit}>
            {busy && <Loader2 size={14} className="spin" />}
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
