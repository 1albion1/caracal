<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" alt="Caracal icon" />
</p>

<h1 align="center">Caracal</h1>

<p align="center"><b>A fast, featherlight SQL client for Windows.</b><br/>
Connect, browse, and query your databases — without the bloat.</p>

---

Caracal is a modern database manager in the spirit of SQL Server Management Studio,
rebuilt for speed: a native Rust core, a ~15 MB standalone executable, instant
startup, and a UI that stays smooth even on huge result sets.

## Features

- **SQL Server & Azure SQL**
  - SQL login, Windows Authentication, or **Microsoft Entra ID with browser
    sign-in** (like SSMS's "Entra MFA" — sign in once, stay signed in)
  - Multi-database servers: browse and switch between all databases on a server,
    with instant name filtering
  - Named instances (`server\SQLEXPRESS`) resolved automatically via SQL Browser
- **SQLite** — open existing files or create new databases with a native file picker
- **Query editor** — syntax highlighting, autocompletion, `Ctrl+Enter` to run,
  and SSMS-style **run-selection**: highlight part of a script and run only that
- **Results grid** — virtualized scrolling through 10,000 rows without stutter,
  drag-to-resize columns, double-click to auto-fit
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

- PostgreSQL and MySQL drivers
- Cancel running queries
- Multiple result sets per batch
- Export results to CSV / copy as insert
- Schema-aware autocompletion

## Known limitations

- SQL Server connections are TCP-only (LocalDB's named pipes are not supported;
  enable TCP/IP for local instances in SQL Server Configuration Manager)
- `GO` batch separators are not supported — run batches separately
- Only the first result set of a multi-statement batch is displayed

## License

[MIT](LICENSE) © Albion Berisha
