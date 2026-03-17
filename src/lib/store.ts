/**
 * Thin wrapper around @tauri-apps/plugin-store.
 * All persisted settings live in "settings.json" inside the app data dir.
 */
import { load } from "@tauri-apps/plugin-store";

let _store: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!_store) {
    _store = await load("settings.json");
  }
  return _store;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const store = await getStore();
    const val = await store.get<T>(key);
    return val ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  try {
    const store = await getStore();
    await store.set(key, value);
  } catch (e) {
    console.error("store write failed", e);
  }
}
