# Caracal — agent handoff notes

A fast, lightweight Windows database management GUI (think small SSMS/DBeaver).
Stack: **Tauri 2 (Rust backend) + React 19 + TypeScript + Vite**.

Renamed from "DB Manager" to **Caracal** on 2026-07-14 (crate `caracal`,
lib `caracal_lib`, identifier `com.albionberisha.caracal`, exe `caracal.exe` /
bundled `Caracal.exe`). `migrate_legacy_config` in lib.rs copies config from the
old `com.albionberisha.db-manager` dir on first run; `KEYRING_SERVICE` stays
`"db-manager"` on purpose so stored passwords keep working. GitHub:
`https://github.com/1albion1/caracal`. The icon sources live in the session
scratchpad (`caracal-icon.html`); regenerate icons with `npm run tauri icon <png>`.
Bundle target is NSIS (per-user install, no admin).

## How to run

```powershell
# cargo is at %USERPROFILE%\.cargo\bin — not always on PATH in fresh shells
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

npm run tauri dev      # full app (Rust backend + UI), first build is slow
npm run dev            # UI only in a browser, served by the in-memory mock
npm run build          # tsc + vite build (frontend type check)
cargo test --manifest-path src-tauri/Cargo.toml --lib   # backend tests
npm run tauri build    # release .exe / installer
```

## Architecture

The UI never talks to a database directly. Everything goes through the
`DataProvider` interface ([src/data/provider.ts](src/data/provider.ts)):

- [src/data/tauri.ts](src/data/tauri.ts) — implements it via Tauri `invoke()` → Rust commands.
- [src/data/mock.ts](src/data/mock.ts) — in-memory fake so the UI works in a plain browser.
- [src/data/index.ts](src/data/index.ts) — picks tauri vs mock by detecting `__TAURI_INTERNALS__`.

Rust side (`src-tauri/src/`):

- `lib.rs` — Tauri commands: `list_connections`, `add_connection`, `remove_connection`,
  `list_databases`, `list_tables`, `run_query`, `create_demo_database`. Dispatches on
  `connection.driver` ("sqlite" | "mssql"); sqlite work runs on `spawn_blocking`,
  mssql is natively async (tiberius on tauri's tokio runtime). SQL login passwords
  are stored in **Windows Credential Manager** (`keyring` crate, service
  `db-manager`, account = connection id) — never in the connections file; they're
  saved in `add_connection` only after a successful test connect, deleted in
  `remove_connection`, and read back in `resolve_secret`.
- `mssql.rs` — SQL Server / Azure SQL driver (tiberius). Auth methods:
  `"sql"` (login+password), `"windows"` (`AuthMethod::Integrated`), `"entra"`
  (browser sign-in, see entra.rs).
  Named instances (`server\SQLEXPRESS`) resolve their port via SQL Browser
  (`sql-browser-tokio` feature); otherwise host:port (default 1433).
  `trust_cert` checkbox for local servers without CA certs. Introspection via
  `sys.objects`/`sys.partitions` (fast approximate row counts) +
  `INFORMATION_SCHEMA.COLUMNS`. `run_query`: plain DML/DDL first-keywords go
  through `execute()` for affected-row counts; everything else streams via
  `simple_query()` — only the FIRST result set is shown, later ones are drained
  (known limitation). One connection per operation, no pooling yet.
  GOTCHAS: tiberius is TCP-only — LocalDB (named pipes) won't work, and local
  instances need TCP/IP enabled in SQL Server Configuration Manager. `GO` batch
  separators are an SSMS-ism and will error.
  **Multi-database servers**: `list_databases` returns all ONLINE databases (user
  DBs first); the sidebar shows a database dropdown, and `list_tables`/`run_query`
  take an optional `database` that overrides the connection default at connect time
  (no `USE` — works on Azure SQL too). The selection is app-global per connection,
  like SSMS's toolbar dropdown, not per query tab.
- `entra.rs` — Microsoft Entra ID sign-in like SSMS's "Entra MFA": OAuth2 auth
  code + PKCE in the system browser, redirect caught on a random loopback port,
  5-minute timeout. Uses Microsoft's well-known Azure CLI public client id
  (`04b07795-…`), which is pre-authorized for Azure SQL in every tenant — no app
  registration needed. Authority is `/organizations` (work accounts).
  **The sign-in is GLOBAL, not per connection** — the token covers the Azure SQL
  resource, so all Entra connections share one session. The refresh token is
  stored DPAPI-encrypted in `entra_token.bin` in the app config dir — NOT in
  Credential Manager, whose ~2.5 KB blob limit silently truncated large Entra
  refresh tokens and caused repeated browser prompts (fixed 2026-07-14; unit
  tests cover the roundtrip). Access tokens are cached in-memory (`TokenCache`
  in lib.rs, expiry minus 120s slack). Silent refresh happens automatically;
  interactive auth omits `prompt=` so browser SSO usually completes without
  clicks even when it does open.
- `sqlite.rs` — SQLite driver (rusqlite, `bundled` feature so SQLite is
  compiled in — no DLLs). Introspection via `sqlite_master` + `PRAGMA table_info`.
  Query results are capped at `MAX_ROWS = 10_000` materialized rows but the full row
  count is still reported (`totalRows`) for the status bar. DDL/DML (no result set)
  returns a synthetic `rows_affected` result. Contains the demo-database seeder
  (deterministic LCG, idempotent — skips if `customers` is non-empty) and unit tests.
- `store.rs` — saved connections, persisted to `connections.json` in the app config dir
  (`%APPDATA%\com.db-manager.app` — see `identifier` in `tauri.conf.json`).
  The demo database file lives in the app data dir as `demo.db`.
- `models.rs` — serde structs, `rename_all = "camelCase"` to match
  [src/types.ts](src/types.ts) exactly. Keep both sides in sync when changing shapes.

Frontend components (`src/components/`): `Sidebar` (connections + schema tree),
`TabBar`, `SqlEditor` (CodeMirror, Ctrl+Enter runs), `ResultsGrid` (TanStack Virtual —
only visible rows in the DOM), `StatusBar`, `ConnectionDialog` (add connection; native
file picker via `@tauri-apps/plugin-dialog`, only shown inside Tauri).

## Conventions

- Rust errors are `Result<_, String>` with human-readable messages; the UI shows them
  verbatim (query errors in the grid, connection errors in the dialog/sidebar).
- SQL identifiers are quoted with `quote_ident` in Rust; never interpolate unquoted.
- `Driver` type already lists `mssql | postgres | mysql | sqlite`; non-sqlite drivers
  are rejected in `add_connection` and disabled in the dialog dropdown ("soon").
- Per-driver SQL dialect differences live in `selectTopSql` in [src/App.tsx](src/App.tsx).

## State (2026-07-13)

The user's goal: an SSMS-like tool — connect to existing servers and manage them
(SELECTs etc.). SQL Server is the priority driver; Entra ID auth matters to them.

Done and verified: `cargo test` green (2 sqlite tests), `npm run build` green, app
launches. SQLite flow fully exercised end-to-end. **The mssql driver compiles but
has NOT been tested against a live server** — the local MSSQLSERVER service was
stopped and couldn't be started without admin. The Entra browser-sign-in flow is
likewise untested against a real tenant. First thing next session: test against a
real SQL Server (start the service as admin, ensure TCP/IP protocol is enabled)
and against Azure SQL with Entra browser sign-in.

## Sensible next steps

1. **Live-test the mssql driver** (see above) and fix whatever falls out.
2. **Postgres/MySQL drivers** via `sqlx` — mssql.rs is the template; enable the
   dropdown options in `ConnectionDialog`.
3. **Cancel running queries** — rusqlite `InterruptHandle` / tiberius cancel token,
   a `cancel_query` command, wire the Run button to toggle to Stop.
4. **Multiple result sets** — grid-per-result-set; mssql already drains them.
5. **Grid niceties** — column resize, sort by click, copy cell/row, export CSV.
6. **Editor autocomplete from schema** — feed table/column names into CodeMirror's
   SQL extension (`schema` option of `@codemirror/lang-sql`).
7. Table DDL view (right-click → "Show CREATE"), execution plan viewer.
