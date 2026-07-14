import { mockProvider } from "./mock";
import type { DataProvider } from "./provider";
import { tauriProvider } from "./tauri";

export const isTauri = "__TAURI_INTERNALS__" in window;

/**
 * Inside the Tauri shell the Rust backend serves real data; in a plain
 * browser (`npm run dev` without Tauri) the mock keeps the UI usable.
 */
export const provider: DataProvider = isTauri ? tauriProvider : mockProvider;
