use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
struct MapEntry {
    name: String,
    mtime: f64,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Lists the .md files directly inside `dir` (no recursion, hidden files skipped).
#[tauri::command]
fn list_maps(dir: String) -> Result<Vec<MapEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || !name.to_lowercase().ends_with(".md") {
            continue;
        }
        let meta = entry.metadata().map_err(err)?;
        if !meta.is_file() {
            continue;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);
        out.push(MapEntry { name, mtime });
    }
    Ok(out)
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(err)
}

/// Writes through a temp file + rename so a crash never leaves a half-written map.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("bad path")?;
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
fn rename_file(from: String, to: String) -> Result<(), String> {
    let to_p = Path::new(&to);
    // Case-only renames are allowed on case-insensitive file systems.
    if to_p.exists() && from.to_lowercase() != to.to_lowercase() {
        return Err("A file with that name already exists".into());
    }
    fs::rename(&from, to_p).map_err(err)
}

/// Moves a map to the OS trash instead of deleting it.
#[tauri::command]
fn trash_file(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_maps,
            read_text,
            write_text,
            write_base64,
            rename_file,
            trash_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ramify");
}
