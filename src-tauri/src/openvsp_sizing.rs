//! OpenVSP / VSPAERO script generation from frontend sizing sketches.

use std::fs;
use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use uuid::Uuid;

use crate::legacy;

#[derive(Debug, Clone)]
struct SizingSurface {
    name: String,
    span_m: f64,
    chord_m: f64,
    y_m: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenVspSizingRequest {
    pub project_name: String,
    pub sizing: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenVspSizingResult {
    pub script_path: String,
    pub vsp3_path: String,
    pub ran_openvsp: bool,
    pub message: String,
    pub stdout: String,
    pub stderr: String,
}

pub fn analyze_sizing(
    app: &AppHandle,
    export_dir: &Path,
    request: OpenVspSizingRequest,
) -> Result<OpenVspSizingResult, String> {
    fs::create_dir_all(export_dir).map_err(|error| error.to_string())?;
    let stem = format!(
        "{}_sizing_{}",
        legacy::sanitize_filename(&request.project_name),
        Uuid::new_v4()
    );
    let script_path = export_dir.join(format!("{stem}.vspscript"));
    let vsp3_path = export_dir.join(format!("{stem}.vsp3"));
    let lifting_surfaces = sizing_lifting_surfaces(&request.sizing);
    let script = sizing_to_openvsp_script(&lifting_surfaces, &request.sizing, &vsp3_path);
    fs::write(&script_path, script).map_err(|error| error.to_string())?;

    if lifting_surfaces.is_empty() {
        return Ok(OpenVspSizingResult {
            script_path: script_path.display().to_string(),
            vsp3_path: vsp3_path.display().to_string(),
            ran_openvsp: false,
            message: "Draw at least one lifting surface before running OpenVSP.".to_string(),
            stdout: String::new(),
            stderr: String::new(),
        });
    }

    if let Some(binary) = legacy::find_openvsp_binary() {
        let output = Command::new(binary)
            .arg("-script")
            .arg(&script_path)
            .output()
            .map_err(|error| error.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            return Ok(OpenVspSizingResult {
                script_path: script_path.display().to_string(),
                vsp3_path: vsp3_path.display().to_string(),
                ran_openvsp: true,
                message: "OpenVSP ran but returned an error. The generated script was saved."
                    .to_string(),
                stdout,
                stderr,
            });
        }
        return Ok(OpenVspSizingResult {
            script_path: script_path.display().to_string(),
            vsp3_path: vsp3_path.display().to_string(),
            ran_openvsp: true,
            message: "OpenVSP model and VSPAERO setup script generated.".to_string(),
            stdout,
            stderr,
        });
    }

    let _ = app;
    Ok(OpenVspSizingResult {
        script_path: script_path.display().to_string(),
        vsp3_path: vsp3_path.display().to_string(),
        ran_openvsp: false,
        message: "OpenVSP was not found. Saved the OpenVSP/VSPAERO script for this sizing sketch."
            .to_string(),
        stdout: String::new(),
        stderr: String::new(),
    })
}

pub fn sizing_lifting_surfaces(sizing: &Value) -> Vec<SizingSurface> {
    sizing
        .get("shapes")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter(|shape| {
            shape.get("role").and_then(|value| value.as_str()) == Some("liftingSurface")
        })
        .filter_map(sizing_surface_from_shape)
        .collect()
}

fn sizing_surface_from_shape(shape: &Value) -> Option<SizingSurface> {
    let points = shape.get("points")?.as_array()?;
    if points.len() < 2 {
        return None;
    }
    let mut max_x = 0.0_f64;
    let mut min_y = 0.0_f64;
    let mut max_y = 0.0_f64;
    let mut sum_y = 0.0_f64;
    for point in points {
        let x = point
            .get("xM")
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0)
            .abs();
        let y = point.get("yM").and_then(|value| value.as_f64()).unwrap_or(0.0);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);
        sum_y += y;
    }
    let span_m = (max_x * 2.0).max(0.05);
    let chord_m = (max_y - min_y).max(0.05);
    let y_m = sum_y / points.len() as f64;
    let name = shape
        .get("label")
        .and_then(|value| value.as_str())
        .unwrap_or("Sizing lifting surface")
        .replace('"', "\\\"");
    Some(SizingSurface {
        name,
        span_m,
        chord_m,
        y_m,
    })
}

pub fn sizing_vspaero_reference(surfaces: &[SizingSurface], sizing: &Value) -> (f64, f64, f64) {
    if let Some(analysis) = sizing.get("analysis") {
        let area = analysis
            .get("wingAreaM2")
            .and_then(|value| value.as_f64())
            .filter(|value| *value > 0.0);
        let chord = analysis
            .get("meanChordM")
            .and_then(|value| value.as_f64())
            .filter(|value| *value > 0.0);
        if let (Some(area), Some(chord)) = (area, chord) {
            return (area, (area / chord).max(0.05), chord);
        }
    }
    let area: f64 = surfaces
        .iter()
        .map(|surface| surface.span_m * surface.chord_m)
        .sum();
    let span: f64 = surfaces.iter().map(|surface| surface.span_m).sum();
    let chord: f64 = if span > 0.0 { area / span } else { 0.2 };
    (area.max(0.01), span.max(0.05), chord.max(0.05))
}

pub fn sizing_to_openvsp_script(
    surfaces: &[SizingSurface],
    sizing: &Value,
    vsp3_path: &Path,
) -> String {
    let speed = sizing
        .get("mission")
        .and_then(|mission| mission.get("cruiseSpeedMS"))
        .and_then(|value| value.as_f64())
        .unwrap_or(17.0);
    let (area, span, chord) = sizing_vspaero_reference(surfaces, sizing);
    let mut script = String::from("void main()\n{\n    ClearVSPModel();\n");
    for surface in surfaces {
        script.push_str(&format!(
            concat!(
                "    string wid = AddGeom(\"WING\");\n",
                "    SetGeomName(wid, \"{name}\");\n",
                "    SetParmVal(wid, \"Sym_Planar_Flag\", \"Sym\", 2);\n",
                "    SetParmVal(wid, \"X_Rel_Location\", \"XForm\", {x});\n",
                "    SetParmVal(wid, \"Y_Rel_Location\", \"XForm\", 0.0);\n",
                "    SetParmVal(wid, \"Z_Rel_Location\", \"XForm\", 0.0);\n",
                "    SetDriverGroup(wid, 1, SPAN_WSECT_DRIVER, ROOTC_WSECT_DRIVER, TIPC_WSECT_DRIVER);\n",
                "    SetParmVal(wid, \"Span\", \"XSec_1\", {half_span});\n",
                "    SetParmVal(wid, \"Root_Chord\", \"XSec_1\", {chord});\n",
                "    SetParmVal(wid, \"Tip_Chord\", \"XSec_1\", {chord});\n",
                "    Update();\n"
            ),
            name = surface.name,
            x = surface.y_m,
            half_span = surface.span_m / 2.0,
            chord = surface.chord_m,
        ));
    }
    script.push_str(&format!(
        concat!(
            "    Update();\n",
            "    WriteVSPFile(\"{vsp3}\");\n",
            "\n",
            "    // VSPAERO hook: OpenVSP exposes VSPAERO through the Analysis Manager.\n",
            "    // This script prepares the geometry and reference values for a VLM run.\n",
            "    string geom_analysis = \"VSPAEROComputeGeometry\";\n",
            "    SetAnalysisInputDefaults(geom_analysis);\n",
            "    ExecAnalysis(geom_analysis);\n",
            "\n",
            "    string aero_analysis = \"VSPAEROSinglePoint\";\n",
            "    SetAnalysisInputDefaults(aero_analysis);\n",
            "    array<double> alpha(1); alpha[0] = 0.0;\n",
            "    array<double> mach(1); mach[0] = {mach};\n",
            "    array<double> sref(1); sref[0] = {area};\n",
            "    array<double> bref(1); bref[0] = {span};\n",
            "    array<double> cref(1); cref[0] = {chord};\n",
            "    SetDoubleAnalysisInput(aero_analysis, \"Alpha\", alpha);\n",
            "    SetDoubleAnalysisInput(aero_analysis, \"Mach\", mach);\n",
            "    SetDoubleAnalysisInput(aero_analysis, \"Sref\", sref);\n",
            "    SetDoubleAnalysisInput(aero_analysis, \"bref\", bref);\n",
            "    SetDoubleAnalysisInput(aero_analysis, \"cref\", cref);\n",
            "    // ExecAnalysis(aero_analysis);\n",
            "}}\n"
        ),
        vsp3 = vsp3_path
            .display()
            .to_string()
            .replace('\\', "\\\\")
            .replace('"', "\\\""),
        mach = speed / 343.0,
        area = area,
        span = span,
        chord = chord,
    ));
    script
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn sizing_openvsp_script_contains_vspaero_hook() {
        let sizing = serde_json::json!({
            "mission": { "cruiseSpeedMS": 17.0 },
            "shapes": [
                {
                    "role": "liftingSurface",
                    "label": "Main wing",
                    "points": [
                        { "xM": 0.0, "yM": 0.1 },
                        { "xM": 1.0, "yM": 0.1 },
                        { "xM": 1.0, "yM": -0.2 },
                        { "xM": 0.0, "yM": -0.2 }
                    ]
                }
            ],
            "analysis": {
                "wingAreaM2": 0.4,
                "meanChordM": 0.2
            }
        });
        let surfaces = sizing_lifting_surfaces(&sizing);
        assert_eq!(surfaces.len(), 1);
        let script = sizing_to_openvsp_script(
            &surfaces,
            &sizing,
            &PathBuf::from("/tmp/cadex-sizing.vsp3"),
        );
        assert!(script.contains("AddGeom(\"WING\")"));
        assert!(script.contains("VSPAEROComputeGeometry"));
        assert!(script.contains("VSPAEROSinglePoint"));
        assert!(script.contains("WriteVSPFile"));
        assert!(script.contains("sref[0] = 0.4"));
        assert!(script.contains("cref[0] = 0.2"));
        assert!(script.contains("bref[0] = 2"));
    }

    #[test]
    fn sizing_vspaero_reference_prefers_analysis() {
        let surfaces = vec![SizingSurface {
            name: "Wing".to_string(),
            span_m: 2.0,
            chord_m: 0.2,
            y_m: 0.0,
        }];
        let sizing = serde_json::json!({
            "analysis": { "wingAreaM2": 0.48, "meanChordM": 0.16 }
        });
        let (area, span, chord) = sizing_vspaero_reference(&surfaces, &sizing);
        assert!((area - 0.48).abs() < 1e-9);
        assert!((chord - 0.16).abs() < 1e-9);
        assert!((span - 3.0).abs() < 1e-9);
    }
}
