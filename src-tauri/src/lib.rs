use tauri::{Manager};
use std::process::Stdio;
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

type LineStore = Arc<Mutex<HashMap<String, Vec<String>>>>;
type DoneStore = Arc<Mutex<HashMap<String, Option<i32>>>>;

struct AppState {
    lines: LineStore,
    done:  DoneStore,
}

#[tauri::command]
fn pick_folder() -> Option<String> {
    rfd::FileDialog::new().pick_folder().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_files(extensions: Vec<String>) -> Option<Vec<String>> {
    let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    rfd::FileDialog::new()
        .add_filter("Media", &ext_refs)
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
    dirs::download_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    match app.updater() {
        Ok(updater) => {
            match updater.check().await {
                Ok(Some(update)) => Ok(Some(update.version.clone())),
                Ok(None) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn start_process(
    state: tauri::State<AppState>,
    program: String,
    args: Vec<String>,
    event_id: String,
) -> Result<(), String> {
    {
        state.lines.lock().unwrap().insert(event_id.clone(), Vec::new());
        state.done.lock().unwrap().insert(event_id.clone(), None);
    }
    let lines_c = state.lines.clone();
    let done_c  = state.done.clone();

    std::thread::spawn(move || {
        let result = std::process::Command::new(&program)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        let mut child = match result {
            Ok(c) => c,
            Err(e) => {
                lines_c.lock().unwrap().entry(event_id.clone()).or_default()
                    .push(format!("[ERROR] Failed to start '{}': {}", program, e));
                done_c.lock().unwrap().insert(event_id, Some(-1));
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let l1 = lines_c.clone(); let e1 = event_id.clone();
        let t1 = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                l1.lock().unwrap().entry(e1.clone()).or_default().push(line);
            }
        });
        let l2 = lines_c.clone(); let e2 = event_id.clone();
        let t2 = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                l2.lock().unwrap().entry(e2.clone()).or_default().push(line);
            }
        });

        let _ = t1.join(); let _ = t2.join();
        let code = child.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        done_c.lock().unwrap().insert(event_id, Some(code));
    });

    Ok(())
}

#[tauri::command]
fn poll_process(state: tauri::State<AppState>, event_id: String) -> (Vec<String>, Option<i32>) {
    let mut out = Vec::new();
    { let mut l = state.lines.lock().unwrap(); if let Some(v) = l.get_mut(&event_id) { out = v.drain(..).collect(); } }
    let code = { state.done.lock().unwrap().get(&event_id).copied().flatten() };
    (out, code)
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
            done:  Arc::new(Mutex::new(HashMap::new())),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            pick_folder, pick_files, get_script_path, get_cwd,
            start_process, poll_process, cleanup_process,
            check_for_update, install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
