use tauri::Manager;
use std::process::Stdio;
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::path::BaseDirectory;
use std::fs;

#[tauri::command]
fn get_sidecar_path(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let target_triple = if cfg!(target_arch = "x86_64") {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else if cfg!(target_os = "macos") {
        "x86_64-apple-darwin"
    } else {
        return Err("Unsupported architecture".to_string());
    };

    let file_name = if cfg!(target_os = "windows") {
        format!("{}-{}.exe", name, target_triple)
    } else {
        format!("{}-{}", name, target_triple)
    };

    let path = app.path()
        .resolve(format!("binaries/{}", file_name), BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    // 3. Fallback: If it's not in resources, check the direct binary sidecar directory
    let final_path = if !path.exists() {
        let fallback_path = app.path()
            .resolve(format!("binaries/{}", name), BaseDirectory::Resource)
            .map_err(|e| e.to_string())?;
        if !fallback_path.exists() {
            return Err(format!(
                "Sidecar binary not found. Tried:\n1. {}\n2. {}", 
                path.display(), 
                fallback_path.display()
            ));
        }
        fallback_path
    } else {
        path
    };

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(&final_path) {
            let mut perms = metadata.permissions();
            if perms.mode() & 0o111 == 0 {
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&final_path, perms);
            }
        }
    }
        
    Ok(final_path.to_string_lossy().to_string())
}

#[tauri::command]
fn list_files_in_folder(dir: String, extensions: Vec<String>) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let paths = fs::read_dir(&dir).map_err(|e| e.to_string())?;

    for path in paths.flatten() {
        if let Ok(file_type) = path.file_type() {
            if file_type.is_file() {
                let path_buf = path.path();
                if let Some(ext) = path_buf.extension().and_then(|s| s.to_str()) {
                    if extensions.contains(&ext.to_lowercase()) {
                        files.push(path_buf.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
async fn ensure_ytdlp_path(app: tauri::AppHandle) -> Result<String, String> {
    // Resolve the App Data Directory safely
    let app_dir = app.path()
        .resolve("", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;

    // Determine the expected name based on operating system
    let exe_name = if cfg!(target_os = "windows") { "yt-dlp.exe" } else { "yt-dlp" };
    let target_path = app_dir.join(exe_name);

    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    if !target_path.exists() {
        let url = if cfg!(target_os = "windows") {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        } else if cfg!(target_os = "macos") {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
        } else {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
        };

        let response = reqwest::blocking::get(url).map_err(|e| e.to_string())?;
        let bytes = response.bytes().map_err(|e| e.to_string())?;
        std::fs::write(&target_path, bytes).map_err(|e| e.to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&target_path).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&target_path, perms).map_err(|e| e.to_string())?;
        }
    }

    Ok(target_path.to_string_lossy().to_string())
}

type LineStore = Arc<Mutex<HashMap<String, Vec<String>>>>;
type DoneStore = Arc<Mutex<HashMap<String, Option<i32>>>>;

struct AppState {
    lines: LineStore,
    done:  DoneStore,
}
fn resolve_path() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("PATH").unwrap_or_default()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let output = std::process::Command::new(&shell)
            .args(["-l", "-c", "echo $PATH"])
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return path;
                }
            }
            _ => {}
        }

        let mut paths: Vec<String> = vec![
            "/opt/homebrew/bin".into(),
            "/usr/local/bin".into(),
            "/usr/bin".into(),
            "/bin".into(),
            "/usr/sbin".into(),
            "/sbin".into(),
        ];
        if let Ok(existing) = std::env::var("PATH") {
            for p in existing.split(':').rev() {
                let owned = p.to_string();
                if !paths.contains(&owned) {
                    paths.insert(0, owned);
                }
            }
        }
        paths.join(":")
    }
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
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => Ok(Some(update.version.clone())),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        },
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
    let full_path = resolve_path();

    std::thread::spawn(move || {
        let result = std::process::Command::new(&program)
            .args(&args)
            .env("PATH", &full_path)
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

        let _ = t1.join();
        let _ = t2.join();
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

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd").args(["/c", "start", &url]).spawn().map_err(|e| e.to_string())?;
    Ok(())
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
        .plugin(tauri_plugin_shell::init()) 
        .invoke_handler(tauri::generate_handler![
            pick_folder, 
            pick_files, 
            get_script_path, 
            get_cwd,
            start_process, 
            poll_process, 
            cleanup_process,
            check_for_update, 
            install_update, 
            open_url,
            ensure_ytdlp_path,
            get_sidecar_path,
            list_files_in_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
