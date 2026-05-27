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

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;

use cad::KernelState;
use model::CadProject;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolRequest {
    project: CadProject,
    name: String,
    args: Value,
    selected_geometry: Option<Value>,
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
        ("POST", "/tool") => run_tool_request(state, body),
        _ => Err(format!("unsupported route {method} {path}")),
    };

    match response {
        Ok(payload) => write_json(&mut stream, 200, &payload),
        Err(error) => write_json(&mut stream, 400, &json!({ "error": error })),
    }
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
