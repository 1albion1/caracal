# Changelog

## 0.2.0 — 2026-07-14

- PostgreSQL driver: password authentication, TLS (with self-signed
  certificate option), multi-database browsing, tables/views/materialized
  views with row estimates, multi-statement scripts via the simple query
  protocol
- Connection dialog adapts per driver (port defaults, auth methods)

## 0.1.0 — 2026-07-14

First release.

- SQL Server / Azure SQL driver: SQL login, Windows Authentication, Microsoft
  Entra ID browser sign-in with persistent session (DPAPI-encrypted refresh token)
- Multi-database servers: database list with name filter, per-database browsing
  and querying (Azure SQL compatible — no `USE` required)
- SQLite driver (bundled, zero dependencies), one-click seeded demo database
- Schema browser with table/column metadata, row counts, and filtering
- Tabbed SQL editor: syntax highlighting, autocompletion, Ctrl+Enter,
  run-selection
- Virtualized results grid: 10,000-row cap with true total count,
  drag-to-resize and double-click-to-fit columns
- Color-coded saved connections, recent-connection prefill in the dialog
- Passwords in Windows Credential Manager; NSIS installer
