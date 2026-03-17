import { invoke } from "@tauri-apps/api/core";

export async function pickFolder(): Promise<string | null> {
  return invoke<string | null>("pick_folder");
}

export async function pickFiles(extensions: string[]): Promise<string[] | null> {
  return invoke<string[] | null>("pick_files", { extensions });
}

export async function getScriptPath(name: string): Promise<string> {
  try {
    return await invoke<string>("get_script_path", { name });
  } catch {
    // dev fallback - scripts/ relative to project root
    return name;
  }
}
