use tauri::{Manager};
use std::process::Stdio;
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

type LineStore = Arc<Mutex<HashMap<String, Vec<String>>>>;
type DoneStore = Arc<Mutex<HashMap<String, Option<i32>>>>;

struct AppState {
    lines: LineStore,
    done: DoneStore,
}

#[tauri::command]
fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_files(extensions: Vec<String>) -> Option<Vec<String>> {
    let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    rfd::FileDialog::new()
        .add_filter("Video", &ext_refs)
        .pick_files()
        .map(|paths| paths.iter().map(|p| p.to_string_lossy().to_string()).collect())
}

#[tauri::command]
fn get_script_path(app: tauri::AppHandle, name: String) -> Result<String, String> {
    app.path().resource_dir()
        .map(|d| d.join(&name).to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_cwd() -> String {
    // Return the user's home directory as the default download location
    dirs::download_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn start_process(
    state: tauri::State<AppState>,
    program: String,
    args: Vec<String>,
    event_id: String,
) -> Result<(), String> {
    {
        let mut lines = state.lines.lock().unwrap();
        lines.insert(event_id.clone(), Vec::new());
        let mut done = state.done.lock().unwrap();
        done.insert(event_id.clone(), None);
    }

    let lines_clone = state.lines.clone();
    let done_clone = state.done.clone();

    std::thread::spawn(move || {
        let result = std::process::Command::new(&program)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        let mut child = match result {
            Ok(c) => c,
            Err(e) => {
                let mut lines = lines_clone.lock().unwrap();
                if let Some(v) = lines.get_mut(&event_id) {
                    v.push(format!("[ERROR] Failed to start '{}': {}", program, e));
                }
                let mut done = done_clone.lock().unwrap();
                done.insert(event_id, Some(-1));
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let lines1 = lines_clone.clone();
        let eid1 = event_id.clone();
        let t1 = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                let mut lock = lines1.lock().unwrap();
                if let Some(v) = lock.get_mut(&eid1) { v.push(line); }
            }
        });

        let lines2 = lines_clone.clone();
        let eid2 = event_id.clone();
        let t2 = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                let mut lock = lines2.lock().unwrap();
                if let Some(v) = lock.get_mut(&eid2) { v.push(line); }
            }
        });

        let _ = t1.join();
        let _ = t2.join();

        let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        let mut done = done_clone.lock().unwrap();
        done.insert(event_id, Some(code));
    });

    Ok(())
}

#[tauri::command]
fn poll_process(
    state: tauri::State<AppState>,
    event_id: String,
) -> (Vec<String>, Option<i32>) {
    let mut lines_out = Vec::new();
    let done_code;
    {
        let mut lines = state.lines.lock().unwrap();
        if let Some(v) = lines.get_mut(&event_id) {
            lines_out = v.drain(..).collect();
        }
    }
    {
        let done = state.done.lock().unwrap();
        done_code = done.get(&event_id).copied().flatten();
    }
    (lines_out, done_code)
}

#[tauri::command]
fn cleanup_process(state: tauri::State<AppState>, event_id: String) {
    state.lines.lock().unwrap().remove(&event_id);
    state.done.lock().unwrap().remove(&event_id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            lines: Arc::new(Mutex::new(HashMap::new())),
            done: Arc::new(Mutex::new(HashMap::new())),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            pick_folder, pick_files, get_script_path, get_cwd,
            start_process, poll_process, cleanup_process
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
