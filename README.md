<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" alt="Caracal icon" />
</p>

<h1 align="center">Caracal</h1>

<p align="center"><b>A fast, featherlight SQL client for Windows.</b><br/>
Connect, browse, and query your databases — without the bloat.</p>

---

Caracal exists because I was tired of SQL Server Management Studio — the wait at
startup, the weight, the clutter — when all I needed was to connect, browse, and
query. It keeps the workflows SSMS got right and rebuilds them for speed: a native
Rust core, a ~15 MB standalone executable, instant startup, and a UI that stays
smooth even on huge result sets. Now with PostgreSQL and SQLite alongside
SQL Server and Azure SQL.

## Features

- **SQL Server & Azure SQL**
  - SQL login, Windows Authentication, or **Microsoft Entra ID with browser
    sign-in** (like SSMS's "Entra MFA" — sign in once, stay signed in)
  - Multi-database servers: browse and switch between all databases on a server,
    with instant name filtering and a refresh button
  - Named instances (`server\SQLEXPRESS`) resolved automatically via SQL Browser
- **PostgreSQL** — password auth with TLS support, full multi-database browsing
  (tables, views, materialized views)
- **SQLite** — open existing files or create new databases with a native file picker
- **Query editor** — syntax highlighting, schema-aware autocompletion,
  `Ctrl+Enter` to run, and SSMS-style **run-selection**: highlight part of a
  script and run only that
- **Execution plans** — Explain (`Ctrl+Shift+Enter`) shows the estimated plan;
  Analyze runs the query and shows the actual plan as a **heat-colored
  flowchart** with real per-step timing (click a step for full metrics),
  so you can see exactly where time is spent — including parallel operators
- **Results grid** — virtualized scrolling through 10,000 rows without stutter,
  drag-to-resize columns, double-click to auto-fit
- **Export** — save any result to CSV (Excel-compatible), Excel .xlsx, or JSON
- **Cancel running queries** — the Run button turns into Stop; cancelling
  ends the work server-side (SQL Server, PostgreSQL)
- **Query tabs** — work on several queries side by side
- **Connection manager** — color-coded saved connections, recent-connection
  prefill, one-click seeded demo database
- **Security by default** — passwords live in the Windows Credential Manager and
  sign-in tokens are DPAPI-encrypted; nothing sensitive is written in plain text

## Install

Download the latest `Caracal_x.y.z_x64-setup.exe` from
[Releases](https://github.com/1albion1/caracal/releases) and run it —
no admin rights required, no dependencies to install.

## Build from source

Requirements: [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/), Windows 10/11.

```powershell
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce the installer (src-tauri/target/release/bundle/nsis)
```

## Tech

Tauri 2 (Rust) + React + TypeScript. Database drivers are native Rust:
[`tiberius`](https://github.com/prisma/tiberius) for SQL Server,
[`rusqlite`](https://github.com/rusqlite/rusqlite) (bundled) for SQLite.
The UI renders in Windows' built-in WebView2 — no embedded Chromium.

## Roadmap

- MySQL driver
- Multiple result sets per batch
- Copy rows as INSERT statements

## Known limitations

- SQL Server connections are TCP-only (LocalDB's named pipes are not supported;
  enable TCP/IP for local instances in SQL Server Configuration Manager)
- `GO` batch separators are not supported — run batches separately
- Only the first result set of a multi-statement batch is displayed

## License

[MIT](LICENSE) © Albion Berisha
