#![allow(dead_code)]

#[path = "../cad/mod.rs"]
mod cad;
#[path = "../dispatch.rs"]
mod dispatch;
#[path = "../legacy.rs"]
mod legacy;
#[path = "../model.rs"]
mod model;
#[path = "../tools.rs"]
mod tools;

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use cad::KernelState;
use model::CadProject;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolRequest {
    project: CadProject,
    name: String,
    args: Value,
    selected_geometry: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectCreateRequest {
    name: String,
    state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectLoadRequest {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSaveRequest {
    expected_updated_at: Option<u128>,
    id: String,
    state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDeleteRequest {
    id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEntry {
    id: String,
    name: String,
    path: String,
    updated_at_ms: u128,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(KernelState::new());
    let listener = TcpListener::bind("127.0.0.1:1421")?;
    eprintln!("cadex kernel bridge listening on http://127.0.0.1:1421");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = Arc::clone(&state);
                std::thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, &state) {
                        eprintln!("cadex bridge request failed: {error}");
                    }
                });
            }
            Err(error) => eprintln!("cadex bridge accept failed: {error}"),
        }
    }
    Ok(())
}

fn handle_connection(mut stream: TcpStream, state: &KernelState) -> Result<(), String> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if request_complete(&buffer) {
            break;
        }
    }

    let request = String::from_utf8_lossy(&buffer);
    let (head, body) = split_request(&request)?;
    let request_line = head.lines().next().ok_or("missing request line")?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or("missing method")?;
    let path = parts.next().ok_or("missing path")?;

    if method == "OPTIONS" {
        return write_json(&mut stream, 204, &json!({}));
    }

    let response = match (method, path) {
        ("GET", "/health") => Ok(json!({ "ok": true, "engine": "cadrum" })),
        ("GET", "/tools") => Ok(json!({ "tools": tools::openai_tool_array() })),
        ("GET", "/projects") => {
            list_aircraft_projects().map(|projects| json!({ "projects": projects }))
        }
        ("POST", "/projects/create") => create_aircraft_project(body),
        ("POST", "/projects/load") => load_aircraft_project(body),
        ("POST", "/projects/save") => save_aircraft_project(body),
        ("POST", "/projects/delete") => delete_aircraft_project(body),
        ("POST", "/tool") => run_tool_request(state, body),
        _ => Err(format!("unsupported route {method} {path}")),
    };

    match response {
        Ok(payload) => write_json(&mut stream, 200, &payload),
        Err(error) => write_json(&mut stream, 400, &json!({ "error": error })),
    }
}

fn list_aircraft_projects() -> Result<Vec<ProjectEntry>, String> {
    let root = aircraft_root()?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let mut projects = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        let path = entry.path().join("aircraft.json");
        if !path.exists() {
            continue;
        }
        let state = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok());
        let id = state
            .as_ref()
            .and_then(|value| value.get("id"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
            .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
        let name = state
            .as_ref()
            .and_then(|value| value.get("name"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
            .unwrap_or_else(|| id.clone());
        let updated_at_ms = path
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        projects.push(ProjectEntry {
            id,
            name,
            path: path.display().to_string(),
            updated_at_ms,
        });
    }
    projects.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(projects)
}

fn create_aircraft_project(body: &str) -> Result<Value, String> {
    let request: ProjectCreateRequest =
        serde_json::from_str(body).map_err(|error| error.to_string())?;
    let id = unique_aircraft_id(&request.name)?;
    let name = request.name.trim();
    let name = if name.is_empty() {
        "Untitled aircraft"
    } else {
        name
    };
    let state = strip_generated_project_state(stamp_project_state(request.state, &id, name));
    let path = aircraft_project_path(&id)?;
    write_project_file(&path, &state)?;
    append_project_journal(&path, None, &state, "create")?;
    Ok(json!({ "project": project_entry_from_state(&state, &path), "state": state }))
}

fn load_aircraft_project(body: &str) -> Result<Value, String> {
    let request: ProjectLoadRequest =
        serde_json::from_str(body).map_err(|error| error.to_string())?;
    let path = aircraft_project_path(&sanitize_id(&request.id))?;
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let state: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    Ok(json!({ "project": project_entry_from_state(&state, &path), "state": state }))
}

fn save_aircraft_project(body: &str) -> Result<Value, String> {
    let request: ProjectSaveRequest =
        serde_json::from_str(body).map_err(|error| error.to_string())?;
    let id = sanitize_id(&request.id);
    let path = aircraft_project_path(&id)?;
    let current = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    if let Some(expected_updated_at) = request.expected_updated_at {
        let current_updated_at = current
            .as_ref()
            .and_then(|value| value.get("updatedAt"))
            .and_then(|value| value.as_u64())
            .map(u128::from);
        if current_updated_at.is_some() && current_updated_at != Some(expected_updated_at) {
            return Err(
                "stale project copy refused; reload the latest aircraft before saving".to_string(),
            );
        }
    }
    let name = current
        .as_ref()
        .and_then(|value| value.get("name"))
        .and_then(|value| value.as_str())
        .or_else(|| request.state.get("name").and_then(|value| value.as_str()))
        .unwrap_or("Untitled aircraft")
        .to_string();
    let state = strip_generated_project_state(stamp_project_state(request.state, &id, &name));
    write_project_file(&path, &state)?;
    append_project_journal(&path, current.as_ref(), &state, "save")?;
    Ok(json!({ "project": project_entry_from_state(&state, &path), "state": state }))
}

fn delete_aircraft_project(body: &str) -> Result<Value, String> {
    let request: ProjectDeleteRequest =
        serde_json::from_str(body).map_err(|error| error.to_string())?;
    let id = sanitize_id(&request.id);
    if id.is_empty() {
        return Err("missing aircraft project id".to_string());
    }
    let project_dir = aircraft_root()?.join(&id);
    if project_dir.exists() {
        fs::remove_dir_all(&project_dir).map_err(|error| error.to_string())?;
        git_add_all(&project_dir);
    }
    Ok(json!({ "deletedId": id, "projects": list_aircraft_projects()? }))
}

fn stamp_project_state(mut state: Value, id: &str, name: &str) -> Value {
    if !state.is_object() {
        state = json!({});
    }
    let object = state.as_object_mut().expect("state object");
    object.insert("id".to_string(), json!(id));
    object.insert("name".to_string(), json!(name));
    object.insert("schemaVersion".to_string(), json!(1));
    object.insert("updatedAt".to_string(), json!(chrono_like_timestamp_ms()));
    state
}

fn strip_generated_project_state(mut state: Value) -> Value {
    strip_openfoam_generated_reports(&mut state);
    if let Some(project) = state.get_mut("project") {
        strip_openfoam_generated_reports(project);
    }
    state
}

fn strip_openfoam_generated_reports(value: &mut Value) {
    let Some(openfoam) = value
        .get_mut("sizing")
        .and_then(|sizing| sizing.get_mut("openFoam"))
        .and_then(|openfoam| openfoam.as_object_mut())
    else {
        return;
    };
    openfoam.remove("geometryReport");
    openfoam.remove("caseReports");
}

fn project_entry_from_state(state: &Value, path: &Path) -> ProjectEntry {
    ProjectEntry {
        id: state
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or("aircraft")
            .to_string(),
        name: state
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("Untitled aircraft")
            .to_string(),
        path: path.display().to_string(),
        updated_at_ms: path
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0),
    }
}

fn write_project_file(path: &Path, state: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    fs::write(path, format!("{text}\n")).map_err(|error| error.to_string())
}

fn append_project_journal(
    path: &Path,
    previous: Option<&Value>,
    state: &Value,
    event: &str,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let journal_path = project_journal_path(path);
    if previous.is_none() {
        return write_project_journal_baseline(&journal_path, state);
    }
    if !journal_has_delta_baseline(&journal_path)? {
        write_project_journal_baseline(&journal_path, previous.unwrap_or(state))?;
    }
    let entry = if let Some(previous) = previous {
        json!({
            "event": event,
            "journalVersion": 2,
            "id": state.get("id").and_then(|value| value.as_str()).unwrap_or("aircraft"),
            "name": state.get("name").and_then(|value| value.as_str()).unwrap_or("Untitled aircraft"),
            "savedAt": chrono_like_timestamp_ms(),
            "baseUpdatedAt": previous.get("updatedAt").and_then(|value| value.as_u64()),
            "updatedAt": state.get("updatedAt").and_then(|value| value.as_u64()),
            "delta": json_delta(previous, state),
        })
    } else {
        baseline_project_journal_entry(state)
    };
    let line = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&journal_path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

fn journal_has_delta_baseline(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut first_line = String::new();
    reader
        .read_line(&mut first_line)
        .map_err(|error| error.to_string())?;
    let first_entry = serde_json::from_str::<Value>(&first_line).ok();
    Ok(first_entry
        .as_ref()
        .and_then(|entry| entry.get("journalVersion"))
        .and_then(|value| value.as_u64())
        == Some(2)
        && first_entry
            .as_ref()
            .and_then(|entry| entry.get("event"))
            .and_then(|value| value.as_str())
            == Some("baseline"))
}

fn write_project_journal_baseline(path: &Path, state: &Value) -> Result<(), String> {
    let entry = baseline_project_journal_entry(state);
    let line = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
    fs::write(path, format!("{line}\n")).map_err(|error| error.to_string())
}

fn baseline_project_journal_entry(state: &Value) -> Value {
    json!({
        "event": "baseline",
        "journalVersion": 2,
        "id": state.get("id").and_then(|value| value.as_str()).unwrap_or("aircraft"),
        "name": state.get("name").and_then(|value| value.as_str()).unwrap_or("Untitled aircraft"),
        "savedAt": chrono_like_timestamp_ms(),
        "updatedAt": state.get("updatedAt").and_then(|value| value.as_u64()),
        "state": state,
    })
}

fn json_delta(previous: &Value, next: &Value) -> Vec<Value> {
    let mut operations = Vec::new();
    push_json_delta("", previous, next, &mut operations);
    operations
}

fn push_json_delta(path: &str, previous: &Value, next: &Value, operations: &mut Vec<Value>) {
    if previous == next {
        return;
    }
    match (previous, next) {
        (Value::Object(previous_object), Value::Object(next_object)) => {
            for key in previous_object.keys() {
                if !next_object.contains_key(key) {
                    operations
                        .push(json!({ "op": "remove", "path": json_pointer_child(path, key) }));
                }
            }
            for (key, next_value) in next_object {
                let child_path = json_pointer_child(path, key);
                if let Some(previous_value) = previous_object.get(key) {
                    push_json_delta(&child_path, previous_value, next_value, operations);
                } else {
                    operations
                        .push(json!({ "op": "add", "path": child_path, "value": next_value }));
                }
            }
        }
        (Value::Array(_), Value::Array(_)) => {
            operations.push(json!({ "op": "replace", "path": path, "value": next }));
        }
        _ => {
            operations.push(json!({ "op": "replace", "path": path, "value": next }));
        }
    }
}

fn json_pointer_child(parent: &str, key: &str) -> String {
    let escaped = key.replace('~', "~0").replace('/', "~1");
    if parent.is_empty() {
        format!("/{escaped}")
    } else {
        format!("{parent}/{escaped}")
    }
}

fn project_journal_path(path: &Path) -> PathBuf {
    path.with_file_name("aircraft.jsonl")
}

fn aircraft_root() -> Result<PathBuf, String> {
    std::env::current_dir()
        .map_err(|error| error.to_string())
        .map(|cwd| cwd.join("aircraft"))
}

fn aircraft_project_path(id: &str) -> Result<PathBuf, String> {
    Ok(aircraft_root()?.join(id).join("aircraft.json"))
}

fn unique_aircraft_id(name: &str) -> Result<String, String> {
    let root = aircraft_root()?;
    let base = sanitize_id(name);
    let base = if base.is_empty() {
        "aircraft".to_string()
    } else {
        base
    };
    for index in 0..1000 {
        let candidate = if index == 0 {
            base.clone()
        } else {
            format!("{base}-{index}")
        };
        if !root.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("Could not allocate a unique aircraft project id.".to_string())
}

fn sanitize_id(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for character in value.trim().to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn git_add(path: &Path) {
    let _ = Command::new("git").arg("add").arg(path).output();
}

fn git_add_all(path: &Path) {
    let _ = Command::new("git").arg("add").arg("-A").arg(path).output();
}

fn chrono_like_timestamp_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn run_tool_request(state: &KernelState, body: &str) -> Result<Value, String> {
    let request: ToolRequest = serde_json::from_str(body).map_err(|error| error.to_string())?;
    let outcome = dispatch::run_tool(
        state,
        request.project,
        &request.name,
        &request.args,
        request.selected_geometry.as_ref(),
    )?;
    Ok(json!({
        "assistantText": outcome.message,
        "project": outcome.project,
    }))
}

fn request_complete(buffer: &[u8]) -> bool {
    let Some(header_end) = find_header_end(buffer) else {
        return false;
    };
    let header = String::from_utf8_lossy(&buffer[..header_end]);
    let content_length = header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    buffer.len() >= header_end + 4 + content_length
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn split_request(request: &str) -> Result<(&str, &str), String> {
    request
        .split_once("\r\n\r\n")
        .ok_or_else(|| "malformed HTTP request".to_string())
}

fn write_json(stream: &mut TcpStream, status: u16, payload: &Value) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        _ => "OK",
    };
    let body = if status == 204 {
        String::new()
    } else {
        serde_json::to_string(payload).map_err(|error| error.to_string())?
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: application/json\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Headers: content-type\r\n\
         Access-Control-Allow-Methods: GET,POST,OPTIONS\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        body.len(),
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| error.to_string())
}
