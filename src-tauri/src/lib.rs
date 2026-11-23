use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
struct MapEntry {
    /// Path relative to the maps folder, always with "/" separators.
    name: String,
    mtime: f64,
}

#[derive(Serialize)]
struct Tree {
    files: Vec<MapEntry>,
    folders: Vec<String>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

const SKIP_DIRS: &[&str] = &["attachments", "node_modules", "target"];
const MAX_DEPTH: usize = 5;

fn walk(root: &Path, dir: &Path, depth: usize, tree: &mut Tree) -> Result<(), String> {
    let rd = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if depth > 0 => {
            eprintln!("skip {:?}: {}", dir, e);
            return Ok(());
        }
        Err(e) => return Err(err(e)),
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .map_err(err)?
            .to_string_lossy()
            .replace('\\', "/");
        if meta.is_dir() {
            if depth + 1 >= MAX_DEPTH || SKIP_DIRS.contains(&name.to_lowercase().as_str()) {
                continue;
            }
            tree.folders.push(rel);
            walk(root, &path, depth + 1, tree)?;
        } else if meta.is_file() && name.to_lowercase().ends_with(".md") {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);
            tree.files.push(MapEntry { name: rel, mtime });
        }
    }
    Ok(())
}

/// Lists .md files and sub-folders of `dir` (hidden and attachment folders skipped).
#[tauri::command]
fn list_maps(dir: String) -> Result<Tree, String> {
    let root = PathBuf::from(&dir);
    let mut tree = Tree { files: Vec::new(), folders: Vec::new() };
    walk(&root, &root, 0, &mut tree)?;
    Ok(tree)
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(err)
}

#[tauri::command]
fn read_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(path).map_err(err)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Writes through a temp file + rename so a crash never leaves a half-written map.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("bad path")?;
    fs::create_dir_all(dir).map_err(err)?;
    let name = path.file_name().ok_or("bad path")?.to_string_lossy();
    let tmp: PathBuf = dir.join(format!(".{}.tmp", name));
    fs::write(&tmp, bytes).map_err(err)?;
    fs::rename(&tmp, path).map_err(err)
}

#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    atomic_write(Path::new(&path), contents.as_bytes())
}

#[tauri::command]
fn write_base64(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(err)?;
    atomic_write(Path::new(&path), &bytes)
}

#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(err)
}

#[tauri::command]
fn rename_file(from: String, to: String) -> Result<(), String> {
    let to_p = Path::new(&to);
    // Case-only renames are allowed on case-insensitive file systems.
    if to_p.exists() && from.to_lowercase() != to.to_lowercase() {
        return Err("A file with that name already exists".into());
    }
    if let Some(parent) = to_p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(&from, to_p).map_err(err)
}

/// Moves a map (or folder) to the OS trash instead of deleting it.
#[tauri::command]
fn trash_file(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    size: u64,
    mtime: f64,
}

/// Files (not folders) directly inside `dir`. A missing folder is an empty list.
#[tauri::command]
fn list_files(dir: String) -> Result<Vec<FileEntry>, String> {
    let rd = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(err(e)),
    };
    let mut out = vec![];
    for entry in rd.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);
        out.push(FileEntry { name: entry.file_name().to_string_lossy().to_string(), size: meta.len(), mtime });
    }
    Ok(out)
}

/// Deletes one backup copy. Only works inside a ".ramify/history" folder, so it
/// can never remove a map or anything else of the user's.
#[tauri::command]
fn remove_backup(path: String) -> Result<(), String> {
    let norm = path.replace('\\', "/");
    if !norm.contains("/.ramify/history/") || norm.contains("/../") {
        return Err("Not a backup".into());
    }
    match fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

/// Copies `from` into directory `to_dir`, never overwriting: "a.png" -> "a 2.png".
/// The same file attached twice is reused instead of copied again.
/// Returns the new file name.
#[tauri::command]
fn copy_into(from: String, to_dir: String) -> Result<String, String> {
    let src = Path::new(&from);
    let dir = Path::new(&to_dir);
    fs::create_dir_all(dir).map_err(err)?;
    let stem = src.file_stem().ok_or("bad path")?.to_string_lossy().to_string();
    let ext = src
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut name = format!("{}{}", stem, ext);
    let mut i = 2;
    let src_bytes = fs::read(src).map_err(err)?;
    while dir.join(&name).exists() {
        if fs::read(dir.join(&name)).map(|b| b == src_bytes).unwrap_or(false) {
            return Ok(name); // identical file already attached
        }
        name = format!("{} {}{}", stem, i, ext);
        i += 1;
    }
    fs::write(dir.join(&name), &src_bytes).map_err(err)?;
    Ok(name)
}

/// File types that run code when opened. A link in a note (maybe in a map from
/// someone else) must never start a program.
const RUNNABLE: &[&str] = &[
    "app", "command", "tool", "sh", "bash", "zsh", "csh", "ksh", "fish", "pkg", "mpkg", "scpt", "applescript",
    "workflow", "terminal", "exe", "msi", "bat", "cmd", "com", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf",
    "wsh", "hta", "scr", "lnk", "reg", "cpl", "msc", "jar", "appimage", "run", "desktop", "py", "pl", "rb",
];

/// Opens a file with the system's default app.
#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(ext) = p.extension() {
        if RUNNABLE.contains(&ext.to_string_lossy().to_lowercase().as_str()) {
            return Err("Ramify doesn't open programs or scripts. Use Finder / Explorer if you trust it.".into());
        }
    }
    app.opener().open_path(path, None::<&str>).map_err(err)
}

/// Opens a web or mail link in the default browser / mail app.
#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err("Only http(s) and mailto links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    body: String,
}

/// Minimal HTTP client for AI providers. Runs outside the web view, so there is
/// no CORS or CSP problem with any provider (cloud API or local Ollama/LM Studio).
#[tauri::command]
async fn http_request(
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs are allowed".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(err)?;
    let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(err)?;
    let mut req = client.request(m, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(err)?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(err)?;
    Ok(HttpResponse { status, body })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // In-app updates (signed releases from GitHub).
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_maps,
            read_text,
            read_base64,
            write_text,
            write_base64,
            make_dir,
            rename_file,
            trash_file,
            copy_into,
            list_files,
            remove_backup,
            open_path,
            open_url,
            http_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ramify");
}
