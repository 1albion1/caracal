# Contributing to Caracal

Thanks for your interest! Caracal is a young project and contributions of all
sizes are welcome — bug reports, feature ideas, docs, and code.

## Development setup

Requirements: [Rust](https://rustup.rs/) (stable), [Node.js](https://nodejs.org/) 18+, Windows 10/11.

```powershell
npm install
npm run tauri dev                                    # full app with hot reload
npm run dev                                          # UI only, in a browser, on mock data
npm run build                                        # TypeScript check + frontend build
cargo test --manifest-path src-tauri/Cargo.toml --lib   # backend tests
```

## Project layout

- `src/` — React UI. All data access goes through the `DataProvider` interface
  in `src/data/provider.ts` (real backend via Tauri IPC, or an in-browser mock).
- `src-tauri/src/` — Rust backend: one module per database driver (`mssql.rs`,
  `sqlite.rs`), `entra.rs` for Microsoft sign-in, `store.rs` for persistence,
  `lib.rs` for the Tauri commands.

See `CLAUDE.md` for a deeper architecture walkthrough and current roadmap.

## Guidelines

- Keep the app fast and light — that's the whole point. Avoid heavy dependencies.
- Errors shown to users should be human-readable sentences, not debug dumps.
- Never write secrets (passwords, tokens) to plain-text files or logs. Use the
  Windows Credential Manager or DPAPI like the existing code does.
- Run `cargo test` and `npm run build` before opening a PR.
- New drivers should follow the shape of `mssql.rs` and be dispatched in `lib.rs`.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, and the
exact error text (Caracal surfaces backend errors verbatim in the UI).
