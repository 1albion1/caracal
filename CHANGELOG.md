# Changelog

## 0.4.0 — 2026-07-15

- Export query results to CSV (Excel-compatible UTF-8 BOM), Excel .xlsx
  (typed numbers, bold headers), or JSON — Export button next to Run,
  format chosen in the native save dialog
- Opening a table now generates `SELECT TOP 100` / `LIMIT 100` with explicit
  column names instead of `SELECT *`
- Tab context menu: right-click for Close, Close others, Close tabs to the
  right, Close all
- Status bar shows transient notices (export confirmations, truncation hints)

## 0.3.0 — 2026-07-14

- Object explorer: the sidebar now groups objects into Tables, Partitions,
  Views, Materialized Views, and Procedures (per driver support); clicking a
  procedure opens an EXEC/CALL template without running it
- Query tabs are bound to the database they were opened under (SSMS-style)
  and show it as a badge; the status bar follows the active tab
- Schema-aware autocompletion: table and column-name suggestions fed from the
  live database schema, with the correct SQL dialect per driver

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
