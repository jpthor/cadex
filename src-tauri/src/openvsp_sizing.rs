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

#[derive(Debug, Clone)]
struct SizingPod {
    name: String,
    center_x_m: f64,
    center_y_m: f64,
    center_z_m: f64,
    length_m: f64,
    radius_m: f64,
    rotation_z_deg: f64,
}

#[derive(Debug, Clone)]
struct SizingProp {
    name: String,
    center_x_m: f64,
    center_y_m: f64,
    center_z_m: f64,
    diameter_m: f64,
    blade_count: i64,
    rotation_z_deg: f64,
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
    let pods = sizing_pods(&request.sizing);
    let props = sizing_props(&request.sizing);
    let script = sizing_to_openvsp_script(&lifting_surfaces, &pods, &props, &request.sizing, &vsp3_path);
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

fn sizing_lifting_surfaces(sizing: &Value) -> Vec<SizingSurface> {
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

fn sizing_pods(sizing: &Value) -> Vec<SizingPod> {
    sizing
        .get("shapes")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(sizing_pod_from_shape)
        .collect()
}

fn sizing_props(sizing: &Value) -> Vec<SizingProp> {
    sizing
        .get("shapes")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(sizing_prop_from_shape)
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

fn sizing_pod_from_shape(shape: &Value) -> Option<SizingPod> {
    let role = shape.get("role").and_then(|value| value.as_str())?;
    let part_type = shape.get("partType").and_then(|value| value.as_str());
    if role == "liftingSurface" || part_type == Some("rotor") {
        return None;
    }
    if let Some(cad) = shape.get("cadGeometry") {
        match cad.get("kind").and_then(|value| value.as_str()) {
            Some("box") => {
                let center = vec3(cad.get("centerM")?)?;
                let size = vec3(cad.get("sizeM")?)?;
                return Some(SizingPod {
                    name: shape_name(shape, "Part"),
                    center_x_m: center[0],
                    center_y_m: center[1],
                    center_z_m: center[2],
                    length_m: size[0].max(0.01),
                    radius_m: (size[1].max(size[2]) / 2.0).max(0.005),
                    rotation_z_deg: 0.0,
                });
            }
            Some("cylinder") => {
                let center = vec3(cad.get("centerM")?)?;
                let axis = vec3(cad.get("axisM")?)?;
                return Some(SizingPod {
                    name: shape_name(shape, "Motor"),
                    center_x_m: center[0],
                    center_y_m: center[1],
                    center_z_m: center[2],
                    length_m: cad.get("lengthM").and_then(|value| value.as_f64()).unwrap_or(0.01).max(0.01),
                    radius_m: cad.get("radiusM").and_then(|value| value.as_f64()).unwrap_or(0.005).max(0.005),
                    rotation_z_deg: axis[1].atan2(axis[0]).to_degrees(),
                });
            }
            Some("revolvedBody") => {
                let center = vec3(cad.get("centerM")?)?;
                return Some(SizingPod {
                    name: shape_name(shape, "Body"),
                    center_x_m: center[0],
                    center_y_m: center[1],
                    center_z_m: center[2],
                    length_m: cad.get("lengthM").and_then(|value| value.as_f64()).unwrap_or(0.01).max(0.01),
                    radius_m: cad.get("radiusM").and_then(|value| value.as_f64()).unwrap_or(0.005).max(0.005),
                    rotation_z_deg: 0.0,
                });
            }
            _ => {}
        }
    }

    let points = shape.get("points")?.as_array()?;
    let bounds = point_bounds(points)?;
    let length_m = (bounds.max_y - bounds.min_y).max(0.01);
    let radius_m = bounds.max_x.max(0.005);
    Some(SizingPod {
        name: shape_name(shape, if role == "body" { "Body" } else { "Part" }),
        center_x_m: (bounds.min_y + bounds.max_y) / 2.0,
        center_y_m: if role == "body" { 0.0 } else { (bounds.min_x + bounds.max_x) / 2.0 },
        center_z_m: 0.0,
        length_m,
        radius_m,
        rotation_z_deg: 0.0,
    })
}

fn sizing_prop_from_shape(shape: &Value) -> Option<SizingProp> {
    if shape.get("role").and_then(|value| value.as_str()) != Some("part")
        || shape.get("partType").and_then(|value| value.as_str()) != Some("rotor")
    {
        return None;
    }
    if let Some(cad) = shape.get("cadGeometry") {
        if cad.get("kind").and_then(|value| value.as_str()) == Some("rotor") {
            let center = vec3(cad.get("centerM")?)?;
            let axis = vec3(cad.get("axisM")?)?;
            let radius = cad.get("radiusM").and_then(|value| value.as_f64()).unwrap_or(0.01).max(0.01);
            return Some(SizingProp {
                name: shape_name(shape, "Rotor"),
                center_x_m: center[0],
                center_y_m: center[1],
                center_z_m: center[2],
                diameter_m: radius * 2.0,
                blade_count: cad.get("bladeCount").and_then(|value| value.as_i64()).unwrap_or(2).max(1),
                rotation_z_deg: axis[1].atan2(axis[0]).to_degrees(),
            });
        }
    }
    let points = shape.get("points")?.as_array()?;
    let start = point(points.first()?)?;
    let end = point(points.get(1)?)?;
    let dx = end[0] - start[0];
    let dy = end[1] - start[1];
    let radius = (dx * dx + dy * dy).sqrt().max(0.01);
    Some(SizingProp {
        name: shape_name(shape, "Rotor"),
        center_x_m: start[1],
        center_y_m: start[0],
        center_z_m: 0.0,
        diameter_m: radius * 2.0,
        blade_count: shape.get("rotorBladeCount").and_then(|value| value.as_i64()).unwrap_or(2).max(1),
        rotation_z_deg: dy.atan2(dx).to_degrees(),
    })
}

fn sizing_vspaero_reference(surfaces: &[SizingSurface], sizing: &Value) -> (f64, f64, f64) {
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

fn sizing_to_openvsp_script(
    surfaces: &[SizingSurface],
    pods: &[SizingPod],
    props: &[SizingProp],
    sizing: &Value,
    vsp3_path: &Path,
) -> String {
    let speed = sizing
        .get("mission")
        .and_then(|mission| mission.get("cruiseSpeedMS"))
        .and_then(|value| value.as_f64())
        .unwrap_or(17.0);
    let (area, span, chord) = sizing_vspaero_reference(surfaces, sizing);
    let mut script = String::from(concat!(
        "void SetIfValid(string gid, string parm, string group, double val)\n",
        "{\n",
        "    string pid = FindParm(gid, parm, group);\n",
        "    if (ValidParm(pid)) { SetParmVal(pid, val); }\n",
        "}\n\n",
        "void main()\n{\n    ClearVSPModel();\n"
    ));
    for pod in pods {
        let fine_ratio = (pod.length_m / pod.radius_m).max(0.1);
        script.push_str(&format!(
            concat!(
                "    string pid = AddGeom(\"POD\");\n",
                "    SetGeomName(pid, \"{name}\");\n",
                "    SetIfValid(pid, \"Length\", \"Design\", {length});\n",
                "    SetIfValid(pid, \"Fine_Ratio\", \"Design\", {fine_ratio});\n",
                "    SetIfValid(pid, \"Fineness_Ratio\", \"Design\", {fine_ratio});\n",
                "    SetIfValid(pid, \"FineRatio\", \"Design\", {fine_ratio});\n",
                "    SetIfValid(pid, \"X_Rel_Location\", \"XForm\", {x});\n",
                "    SetIfValid(pid, \"Y_Rel_Location\", \"XForm\", {y});\n",
                "    SetIfValid(pid, \"Z_Rel_Location\", \"XForm\", {z});\n",
                "    SetIfValid(pid, \"Z_Rel_Rotation\", \"XForm\", {rz});\n",
                "    Update();\n"
            ),
            name = escape_script_string(&pod.name),
            length = pod.length_m,
            fine_ratio = fine_ratio,
            x = pod.center_x_m,
            y = pod.center_y_m,
            z = pod.center_z_m,
            rz = pod.rotation_z_deg,
        ));
    }
    for prop in props {
        script.push_str(&format!(
            concat!(
                "    string propid = AddGeom(\"PROP\");\n",
                "    SetGeomName(propid, \"{name}\");\n",
                "    SetIfValid(propid, \"Diameter\", \"Design\", {diameter});\n",
                "    SetIfValid(propid, \"NumBlade\", \"Design\", {blades});\n",
                "    SetIfValid(propid, \"X_Rel_Location\", \"XForm\", {x});\n",
                "    SetIfValid(propid, \"Y_Rel_Location\", \"XForm\", {y});\n",
                "    SetIfValid(propid, \"Z_Rel_Location\", \"XForm\", {z});\n",
                "    SetIfValid(propid, \"Z_Rel_Rotation\", \"XForm\", {rz});\n",
                "    Update();\n"
            ),
            name = escape_script_string(&prop.name),
            diameter = prop.diameter_m,
            blades = prop.blade_count,
            x = prop.center_x_m,
            y = prop.center_y_m,
            z = prop.center_z_m,
            rz = prop.rotation_z_deg,
        ));
    }
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
            name = escape_script_string(&surface.name),
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

#[derive(Debug)]
struct Bounds {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

fn point_bounds(points: &[Value]) -> Option<Bounds> {
    let mut bounds = Bounds {
        min_x: f64::INFINITY,
        max_x: 0.0,
        min_y: f64::INFINITY,
        max_y: f64::NEG_INFINITY,
    };
    for value in points {
        let [x, y] = point(value)?;
        let x = x.abs();
        bounds.min_x = bounds.min_x.min(x);
        bounds.max_x = bounds.max_x.max(x);
        bounds.min_y = bounds.min_y.min(y);
        bounds.max_y = bounds.max_y.max(y);
    }
    if bounds.min_x.is_finite() && bounds.min_y.is_finite() {
        Some(bounds)
    } else {
        None
    }
}

fn point(value: &Value) -> Option<[f64; 2]> {
    Some([
        value.get("xM").and_then(|value| value.as_f64()).unwrap_or(0.0),
        value.get("yM").and_then(|value| value.as_f64()).unwrap_or(0.0),
    ])
}

fn vec3(value: &Value) -> Option<[f64; 3]> {
    let array = value.as_array()?;
    Some([
        array.first()?.as_f64()?,
        array.get(1)?.as_f64()?,
        array.get(2)?.as_f64()?,
    ])
}

fn shape_name(shape: &Value, fallback: &str) -> String {
    shape
        .get("label")
        .and_then(|value| value.as_str())
        .unwrap_or(fallback)
        .to_string()
}

fn escape_script_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
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
                    "role": "body",
                    "label": "Body",
                    "cadGeometry": {
                        "kind": "revolvedBody",
                        "centerM": [-0.5, 0.0, 0.0],
                        "lengthM": 1.0,
                        "radiusM": 0.15
                    },
                    "points": [
                        { "xM": 0.0, "yM": 0.0 },
                        { "xM": 0.15, "yM": 0.0 },
                        { "xM": 0.15, "yM": -1.0 },
                        { "xM": 0.0, "yM": -1.0 }
                    ]
                },
                {
                    "role": "liftingSurface",
                    "label": "Main wing",
                    "points": [
                        { "xM": 0.0, "yM": 0.1 },
                        { "xM": 1.0, "yM": 0.1 },
                        { "xM": 1.0, "yM": -0.2 },
                        { "xM": 0.0, "yM": -0.2 }
                    ]
                },
                {
                    "role": "part",
                    "partType": "battery",
                    "label": "Battery",
                    "cadGeometry": {
                        "kind": "box",
                        "centerM": [-0.5, 0.2, 0.0],
                        "sizeM": [0.4, 0.2, 0.2]
                    },
                    "points": [
                        { "xM": 0.1, "yM": -0.3 },
                        { "xM": 0.3, "yM": -0.3 },
                        { "xM": 0.3, "yM": -0.7 },
                        { "xM": 0.1, "yM": -0.7 }
                    ]
                },
                {
                    "role": "part",
                    "partType": "rotor",
                    "label": "Rotor",
                    "rotorBladeCount": 4,
                    "cadGeometry": {
                        "kind": "rotor",
                        "centerM": [-0.8, 0.4, 0.0],
                        "axisM": [0.0, 1.0, 0.0],
                        "radiusM": 0.3,
                        "bladeCount": 4,
                        "rootChordM": 0.03,
                        "tipChordM": 0.015
                    },
                    "points": [
                        { "xM": 0.4, "yM": -0.8 },
                        { "xM": 0.7, "yM": -0.8 }
                    ]
                }
            ],
            "analysis": {
                "wingAreaM2": 0.4,
                "meanChordM": 0.2
            }
        });
        let surfaces = sizing_lifting_surfaces(&sizing);
        let pods = sizing_pods(&sizing);
        let props = sizing_props(&sizing);
        assert_eq!(surfaces.len(), 1);
        assert_eq!(pods.len(), 2);
        assert_eq!(props.len(), 1);
        let script = sizing_to_openvsp_script(
            &surfaces,
            &pods,
            &props,
            &sizing,
            &PathBuf::from("/tmp/cadex-sizing.vsp3"),
        );
        assert!(script.contains("AddGeom(\"WING\")"));
        assert!(script.contains("AddGeom(\"POD\")"));
        assert!(script.contains("AddGeom(\"PROP\")"));
        assert!(script.contains("SetGeomName(pid, \"Battery\")"));
        assert!(script.contains("SetIfValid(propid, \"Diameter\", \"Design\", 0.6)"));
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
