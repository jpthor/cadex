#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cad;
mod dispatch;
mod legacy;
mod model;
mod openai_response;
mod openvsp_sizing;
mod tools;

use openai_response::{extract_function_calls, extract_output_text};
use openvsp_sizing::{OpenVspSizingRequest, OpenVspSizingResult};

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use tauri::Manager;
use uuid::Uuid;

use crate::cad::KernelState;
use crate::model::{
    CadObject, CadProject, DesignRequest, ExportRequest, ExportResult, ImportRequest,
    OpenAiRequest, OpenAiResult, TimelineEvent,
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MachUpXRequest {
    project_name: String,
    sizing: Value,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenFoamRequest {
    project_name: String,
    sizing: Value,
    mesh: Option<bool>,
    solve: Option<bool>,
    lex_sweep: Option<bool>,
    prop_swirl_sweep: Option<bool>,
    wingevon_alpha: Option<bool>,
    cruise: Option<bool>,
    reuse_geometry: Option<bool>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParaViewRequest {
    project_name: String,
    sizing: Value,
    render_options: Option<Value>,
}

#[tauri::command]
fn create_project() -> CadProject {
    CadProject {
        id: Uuid::new_v4().to_string(),
        name: "Untitled aircraft".to_string(),
        units: "m".to_string(),
        objects: Vec::new(),
        timeline: vec![TimelineEvent {
            id: Uuid::new_v4().to_string(),
            label: "Project created".to_string(),
            detail: "Ready for a wing, flying wing, or aircraft command.".to_string(),
        }],
    }
}

#[tauri::command]
fn design_from_prompt(request: DesignRequest) -> Result<CadProject, String> {
    let mut project = request.project;
    let wing = legacy::parse_wing_prompt(&request.prompt);
    let detail = format!(
        "{} m span, {} m root chord, {} airfoil",
        wing.span_m, wing.root_chord_m, wing.airfoil
    );
    project.objects.push(CadObject::Wing(wing));
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "Generated wing".to_string(),
        detail,
    });
    Ok(project)
}

#[tauri::command]
fn list_cad_tools() -> Vec<Value> {
    tools::openai_tool_array()
}

#[tauri::command]
fn export_model(
    app: tauri::AppHandle,
    state: tauri::State<KernelState>,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    let stem = legacy::sanitize_filename(&request.project.name);
    let kernel_handles: Vec<String> = request
        .project
        .objects
        .iter()
        .filter_map(|o| o.kernel_handle().map(|h| h.to_string()))
        .collect();

    match request.format.as_str() {
        "stl" => {
            let stl_path = match request.path.as_deref() {
                Some(custom) => PathBuf::from(custom),
                None => default_export_dir(&app)?.join(format!("{stem}.stl")),
            };
            ensure_parent_dir(&stl_path)?;
            // Prefer the cadrum mesher if there are any kernel solids; otherwise
            // fall back to the legacy parametric STL writer for wings/meshes.
            if !kernel_handles.is_empty() {
                cad::io::write_stl(&state, &kernel_handles, &stl_path, 0.0005)
                    .map_err(|e| e.to_string())?;
            } else {
                fs::write(
                    &stl_path,
                    legacy::project_to_stl_legacy(&request.project.objects),
                )
                .map_err(|error| error.to_string())?;
            }
            Ok(ExportResult {
                path: stl_path.display().to_string(),
                message: "STL mesh exported.".to_string(),
            })
        }
        "step" => {
            let step_path = match request.path.as_deref() {
                Some(custom) => PathBuf::from(custom),
                None => default_export_dir(&app)?.join(format!("{stem}.step")),
            };
            ensure_parent_dir(&step_path)?;
            // cadrum-native STEP export is preferred for kernel solids. Wings
            // still go through OpenVSP for now since they are NACA-parametric
            // surfaces, not BREP solids.
            if !kernel_handles.is_empty() {
                cad::io::write_step(&state, &kernel_handles, &step_path)
                    .map_err(|e| e.to_string())?;
                Ok(ExportResult {
                    path: step_path.display().to_string(),
                    message: format!(
                        "STEP exported via cadrum ({} solid(s)).",
                        kernel_handles.len()
                    ),
                })
            } else {
                let script_path = step_path.with_extension("vspscript");
                fs::write(
                    &script_path,
                    legacy::project_to_openvsp_script(&request.project.objects, &step_path),
                )
                .map_err(|error| error.to_string())?;
                if let Some(binary) = legacy::find_openvsp_binary() {
                    let output = Command::new(binary)
                        .arg("-script")
                        .arg(&script_path)
                        .output()
                        .map_err(|error| error.to_string())?;
                    if !output.status.success() {
                        return Err(String::from_utf8_lossy(&output.stderr).to_string());
                    }
                    Ok(ExportResult {
                        path: step_path.display().to_string(),
                        message: "STEP exported through OpenVSP (legacy wing path).".to_string(),
                    })
                } else {
                    Ok(ExportResult {
                        path: script_path.display().to_string(),
                        message: "OpenVSP not found. Saved an OpenVSP script next to the requested STEP path; install OpenVSP and rerun, or create kernel solids to use the cadrum STEP exporter.".to_string(),
                    })
                }
            }
        }
        other => Err(format!("Unsupported export format: {other}")),
    }
}

#[tauri::command]
fn import_model(
    state: tauri::State<KernelState>,
    request: ImportRequest,
) -> Result<CadProject, String> {
    let format = request.format.to_lowercase();
    let path = PathBuf::from(&request.path);

    match format.as_str() {
        "stl" => {
            let bytes = fs::read(&path).map_err(|error| error.to_string())?;
            let mesh = legacy::parse_stl(&bytes, &path)?;
            let triangle_count = mesh.triangle_count;
            let source = mesh.source.clone();
            let mut project = request.project;
            let detail = format!("{triangle_count} triangles from {source}");
            project.objects.push(CadObject::Mesh(mesh));
            project.timeline.push(TimelineEvent {
                id: Uuid::new_v4().to_string(),
                label: "Imported STL".to_string(),
                detail,
            });
            Ok(project)
        }
        "step" => {
            let handles = cad::io::read_step(&state, &path).map_err(|error| error.to_string())?;
            let mut project = request.project;
            for handle in handles {
                let mesh = cad::tessellate::tessellate(&state, &handle, None)
                    .map_err(|error| error.to_string())?;
                let solid = model::SolidObject {
                    id: Uuid::new_v4().to_string(),
                    name: path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Imported solid")
                        .to_string(),
                    source: format!("STEP {}", path.display()),
                    kernel_handle: handle,
                    triangle_count: mesh.triangle_count,
                    positions: mesh.positions,
                    normals: mesh.normals,
                };
                project.objects.push(CadObject::Solid(solid));
            }
            project.timeline.push(TimelineEvent {
                id: Uuid::new_v4().to_string(),
                label: "Imported STEP".to_string(),
                detail: path.display().to_string(),
            });
            Ok(project)
        }
        other => Err(format!("Unsupported import format: {other}")),
    }
}

#[tauri::command]
async fn send_openai_tool_message(
    state: tauri::State<'_, KernelState>,
    request: OpenAiRequest,
) -> Result<OpenAiResult, String> {
    let client = reqwest::Client::new();
    let selected_geometry_text = match &request.selected_geometry {
        Some(selection) => format!(
            "Current selected geometry: {selection}. Use it as the anchor when the user says \"here\", \"this\", \"selected\", or asks to add geometry without another location."
        ),
        None => "No canvas geometry is currently selected.".to_string(),
    };
    let body = serde_json::json!({
        "model": request.model,
        "input": [
            {
                "role": "system",
                "content": "You are Cadex, a CAD copilot for aircraft and parametric design. Use SI units; convert cm/mm to metres. Prefer kernel-backed primitives (create_box / create_cylinder / extrude_polygon / boolean_*) for solid geometry. The legacy create_wing tool is still available for parametric NACA wings. When a tool is marked [stub], you may still call it to register intent — the system will note it as not-yet-implemented in the timeline."
            },
            { "role": "system", "content": selected_geometry_text },
            { "role": "user", "content": request.message }
        ],
        "tools": tools::openai_tool_array()
    });

    let response: serde_json::Value = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(request.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    if let Some(error) = response.get("error") {
        return Err(error.to_string());
    }

    let mut project = request.project;
    let mut assistant_text = extract_output_text(&response)
        .unwrap_or_else(|| "I updated the design using the available CAD tools.".to_string());
    let mut tool_messages: Vec<String> = Vec::new();

    for call in extract_function_calls(&response) {
        match dispatch::run_tool(
            &state,
            project.clone(),
            &call.name,
            &call.arguments,
            request.selected_geometry.as_ref(),
        ) {
            Ok(outcome) => {
                project = outcome.project;
                tool_messages.push(format!("[{}] {}", call.name, outcome.message));
            }
            Err(err) => {
                tool_messages.push(format!("[{}] error: {err}", call.name));
            }
        }
    }

    if !tool_messages.is_empty() {
        assistant_text = tool_messages.join("\n");
    }

    Ok(OpenAiResult {
        assistant_text,
        project,
    })
}

fn default_export_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("exports");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn analyze_sizing_openvsp(
    app: tauri::AppHandle,
    request: OpenVspSizingRequest,
) -> Result<OpenVspSizingResult, String> {
    let export_dir = default_export_dir(&app)?.join("openvsp");
    openvsp_sizing::analyze_sizing(&app, &export_dir, request)
}

#[tauri::command]
fn analyze_sizing_machupx(app: tauri::AppHandle, request: MachUpXRequest) -> Result<Value, String> {
    let export_dir = default_export_dir(&app)?.join("machupx");
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;
    let stem = legacy::sanitize_filename(&request.project_name);
    let input_path = export_dir.join(format!("{stem}_cadex_input.json"));
    let input = serde_json::json!({
        "name": request.project_name,
        "sizing": request.sizing,
    });
    fs::write(
        &input_path,
        serde_json::to_string_pretty(&input).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let script_path = std::env::current_dir()
        .map_err(|error| error.to_string())?
        .join("scripts")
        .join("analyze-machupx.mjs");
    let output = Command::new("node")
        .arg("--experimental-strip-types")
        .arg(script_path)
        .arg(&input_path)
        .arg(&export_dir)
        .arg("--json-only")
        .output()
        .map_err(|error| format!("MachUpX analysis could not start: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Ok(serde_json::json!({
            "ok": false,
            "solver": "MachUpX",
            "message": "MachUpX analysis failed.",
            "stdout": stdout,
            "stderr": stderr,
        }));
    }

    serde_json::from_str(&stdout).map_err(|error| {
        format!("MachUpX returned invalid JSON: {error}. stdout: {stdout}. stderr: {stderr}")
    })
}

#[tauri::command]
fn analyze_sizing_openfoam(
    app: tauri::AppHandle,
    request: OpenFoamRequest,
) -> Result<Value, String> {
    let export_dir = default_export_dir(&app)?.join("openfoam");
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;
    let stem = legacy::sanitize_filename(&request.project_name);
    let input_path = export_dir.join(format!("{stem}_cadex_input.json"));
    let input = serde_json::json!({
        "name": request.project_name,
        "sizing": request.sizing,
    });
    fs::write(
        &input_path,
        serde_json::to_string_pretty(&input).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let script_path = std::env::current_dir()
        .map_err(|error| error.to_string())?
        .join("scripts")
        .join("analyze-openfoam.mjs");
    let mut command = Command::new("node");
    command
        .arg(script_path)
        .arg(&input_path)
        .arg(&export_dir)
        .arg("--json-only");
    if request.mesh.unwrap_or(false) {
        command.arg("--mesh");
    }
    if request.solve.unwrap_or(false) {
        command.arg("--solve");
    }
    if request.lex_sweep.unwrap_or(false) {
        command.arg("--lex-sweep");
    }
    if request.prop_swirl_sweep.unwrap_or(false) {
        command.arg("--prop-swirl-sweep");
    }
    if request.wingevon_alpha.unwrap_or(false) {
        command.arg("--wingevon-alpha25");
    }
    if request.cruise.unwrap_or(false) {
        command.arg("--cruise");
    }
    if request.reuse_geometry.unwrap_or(false) {
        command.arg("--reuse-geometry");
    }
    let output = command
        .output()
        .map_err(|error| format!("OpenFOAM analysis could not start: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Ok(serde_json::json!({
            "ok": false,
            "solver": "OpenFOAM",
            "message": "OpenFOAM analysis failed.",
            "stdout": stdout,
            "stderr": stderr,
        }));
    }

    serde_json::from_str(&stdout).map_err(|error| {
        format!("OpenFOAM returned invalid JSON: {error}. stdout: {stdout}. stderr: {stderr}")
    })
}

#[tauri::command]
fn render_sizing_paraview(
    app: tauri::AppHandle,
    request: ParaViewRequest,
) -> Result<Value, String> {
    let export_dir = default_export_dir(&app)?.join("paraview");
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;
    let stem = legacy::sanitize_filename(&request.project_name);
    let input_path = export_dir.join(format!("{stem}_cadex_input.json"));
    let input = serde_json::json!({
        "name": request.project_name,
        "sizing": request.sizing,
        "renderOptions": request.render_options,
    });
    fs::write(
        &input_path,
        serde_json::to_string_pretty(&input).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let script_path = std::env::current_dir()
        .map_err(|error| error.to_string())?
        .join("scripts")
        .join("render-paraview.mjs");
    let output = Command::new("node")
        .arg(script_path)
        .arg(&input_path)
        .arg(&export_dir)
        .arg("--json-only")
        .output()
        .map_err(|error| format!("ParaView render could not start: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Ok(serde_json::json!({
            "ok": false,
            "solver": "ParaView",
            "message": "ParaView render failed.",
            "stdout": stdout,
            "stderr": stderr,
        }));
    }

    serde_json::from_str(&stdout).map_err(|error| {
        format!("ParaView returned invalid JSON: {error}. stdout: {stdout}. stderr: {stderr}")
    })
}

fn main() {
    tauri::Builder::default()
        .manage(KernelState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            create_project,
            design_from_prompt,
            list_cad_tools,
            export_model,
            import_model,
            analyze_sizing_openvsp,
            analyze_sizing_machupx,
            analyze_sizing_openfoam,
            render_sizing_paraview,
            send_openai_tool_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cadex");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::legacy::*;
    use crate::model::{CadObject, Wing};

    fn empty_project() -> CadProject {
        CadProject {
            id: "p".to_string(),
            name: "Test aircraft".to_string(),
            units: "m".to_string(),
            objects: Vec::new(),
            timeline: Vec::new(),
        }
    }

    fn wing_for_test() -> Wing {
        parse_wing_prompt("design a wing, 100cm long, 20cm chord, NACA aerofoil 2412")
    }

    #[test]
    fn parses_cm_dimension() {
        assert_eq!(parse_dimension_token("100cm"), Some(1.0));
    }

    #[test]
    fn parses_mm_dimension() {
        assert_eq!(parse_dimension_token("250mm"), Some(0.25));
    }

    #[test]
    fn parses_metre_and_unitless_dimensions() {
        assert_eq!(parse_dimension_token("1.5m"), Some(1.5));
        assert_eq!(parse_dimension_token("2"), Some(2.0));
    }

    #[test]
    fn rejects_unknown_unit() {
        assert_eq!(parse_dimension_token("1ft"), None);
    }

    #[test]
    fn extracts_naca_4_digit() {
        assert_eq!(
            extract_naca("design naca 2412 wing"),
            Some("NACA 2412".to_string())
        );
    }

    #[test]
    fn ignores_short_naca_designation() {
        assert!(extract_naca("naca 24").is_none());
    }

    #[test]
    fn parses_full_prompt() {
        let wing = wing_for_test();
        assert!((wing.span_m - 1.0).abs() < 1e-9);
        assert!((wing.root_chord_m - 0.2).abs() < 1e-9);
        assert!((wing.tip_chord_m - 0.2).abs() < 1e-9);
        assert_eq!(wing.airfoil, "NACA 2412");
        assert!(wing.symmetry);
    }

    #[test]
    fn defaults_when_dimensions_missing() {
        let wing = parse_wing_prompt("create a wing");
        assert!((wing.span_m - 1.0).abs() < 1e-9);
        assert!((wing.root_chord_m - 0.2).abs() < 1e-9);
        assert_eq!(wing.airfoil, "NACA 2412");
    }

    #[test]
    fn stl_writes_unit_normals() {
        let mut project = empty_project();
        project.objects.push(CadObject::Wing(wing_for_test()));
        let stl = project_to_stl_legacy(&project.objects);
        assert!(stl.starts_with("solid cadex"));
        assert!(stl.contains("facet normal"));
        assert!(!stl.contains("facet normal 0 0 0"));
        assert!(stl.trim_end().ends_with("endsolid cadex"));
    }

    #[test]
    fn triangle_normal_is_unit_length() {
        let n = triangle_normal([0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]);
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        assert!((len - 1.0).abs() < 1e-9);
        assert!((n[2] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn openvsp_script_uses_correct_groups() {
        let mut project = empty_project();
        project.objects.push(CadObject::Wing(wing_for_test()));
        let script =
            project_to_openvsp_script(&project.objects, &PathBuf::from("/tmp/cadex-test.step"));
        assert!(script.contains("AddGeom(\"WING\")"));
        assert!(script.contains("Sym_Planar_Flag"));
        assert!(script.contains("SPAN_WSECT_DRIVER"));
        assert!(script.contains("\"Span\", \"XSec_1\""));
        assert!(script.contains("EXPORT_STEP"));
    }

    #[test]
    fn sanitize_filename_replaces_non_alphanumeric() {
        assert_eq!(sanitize_filename("My Aircraft"), "My_Aircraft");
        assert_eq!(sanitize_filename(""), "cadex_export");
        assert_eq!(sanitize_filename("wing/v1"), "wing_v1");
    }

    #[test]
    fn parses_ascii_stl_into_triangles() {
        let stl = b"solid demo\n  facet normal 0 0 1\n    outer loop\n      vertex 0 0 0\n      vertex 1 0 0\n      vertex 0 1 0\n    endloop\n  endfacet\nendsolid demo\n";
        let mesh = parse_stl(stl, Path::new("demo.stl")).expect("parse ascii stl");
        assert_eq!(mesh.triangle_count, 1);
        assert_eq!(mesh.positions.len(), 9);
        assert_eq!(mesh.normals.len(), 9);
        assert!((mesh.normals[2] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn parses_binary_stl_into_triangles() {
        let mut bytes = vec![0u8; 80];
        bytes.extend_from_slice(&1u32.to_le_bytes());
        let triangle: [f32; 12] = [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        for value in triangle {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes.extend_from_slice(&0u16.to_le_bytes());
        assert!(looks_like_binary_stl(&bytes));
        let mesh = parse_stl(&bytes, Path::new("/tmp/cube.stl")).expect("parse binary stl");
        assert_eq!(mesh.triangle_count, 1);
        assert!((mesh.normals[2] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn looks_like_binary_stl_is_size_based() {
        let mut bytes = vec![b's', b'o', b'l', b'i', b'd'];
        bytes.extend(std::iter::repeat(b' ').take(75));
        bytes.extend_from_slice(&5u32.to_le_bytes());
        assert!(!looks_like_binary_stl(&bytes), "header alone is not binary");
    }

    #[test]
    fn empty_stl_returns_error() {
        let stl = b"solid empty\nendsolid empty\n";
        let result = parse_stl(stl, Path::new("empty.stl"));
        assert!(result.is_err());
    }

    #[test]
    fn tool_catalog_has_expected_categories() {
        let cat = crate::tools::catalog();
        assert!(cat.iter().any(|t| t.name == "create_box"));
        assert!(cat.iter().any(|t| t.name == "boolean_subtract"));
        assert!(cat.iter().any(|t| t.name == "fillet_edges"));
        assert!(cat.iter().any(|t| t.name == "create_wing"));
        assert!(cat.iter().any(|t| t.name == "sheet_metal_base_flange"));
        assert!(cat.len() >= 80, "expected ≥80 tools, got {}", cat.len());
    }
}
