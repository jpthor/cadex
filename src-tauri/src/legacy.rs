//! Legacy aircraft / wing / OpenVSP code path. Kept so the existing wing
//! design flow keeps working while the new cadrum-backed solid path comes
//! online. Anything in this module is operating on the parametric `Wing`
//! mesh, not on a kernel solid.

use std::path::{Path, PathBuf};
use std::process::Command;

use uuid::Uuid;

use crate::model::{CadObject, MeshObject, Wing};

pub fn parse_wing_prompt(prompt: &str) -> Wing {
    let lower = prompt.to_lowercase();
    let span_m = extract_dimension_m(&lower, &["long", "span", "wingspan"]).unwrap_or(1.0);
    let root_chord_m = extract_dimension_m(&lower, &["chord"]).unwrap_or(0.2);
    let airfoil = extract_naca(&lower).unwrap_or_else(|| "NACA 2412".to_string());
    Wing {
        id: Uuid::new_v4().to_string(),
        name: "Main wing".to_string(),
        span_m,
        root_chord_m,
        tip_chord_m: root_chord_m,
        sweep_deg: 0.0,
        dihedral_deg: 0.0,
        twist_deg: 0.0,
        airfoil,
        symmetry: true,
    }
}

pub fn extract_dimension_m(prompt: &str, labels: &[&str]) -> Option<f64> {
    let tokens: Vec<&str> = prompt.split_whitespace().collect();
    for index in 0..tokens.len() {
        let token = tokens[index].trim_matches(|ch: char| ch == ',' || ch == '.');
        if let Some(value) = parse_dimension_token(token) {
            let near_label = tokens
                .iter()
                .skip(index.saturating_sub(2))
                .take(5)
                .any(|candidate| labels.iter().any(|label| candidate.contains(label)));
            if near_label {
                return Some(value);
            }
        }
    }
    None
}

pub fn parse_dimension_token(token: &str) -> Option<f64> {
    let split_at = token
        .find(|ch: char| !(ch.is_ascii_digit() || ch == '.'))
        .unwrap_or(token.len());
    let (number, unit) = token.split_at(split_at);
    let value: f64 = number.parse().ok()?;
    match unit {
        "mm" => Some(value / 1000.0),
        "cm" => Some(value / 100.0),
        "m" | "" => Some(value),
        _ => None,
    }
}

pub fn extract_naca(prompt: &str) -> Option<String> {
    let words: Vec<&str> = prompt.split_whitespace().collect();
    for pair in words.windows(2) {
        if pair[0] == "naca" {
            let digits: String = pair[1].chars().filter(|ch| ch.is_ascii_digit()).collect();
            if digits.len() == 4 {
                return Some(format!("NACA {digits}"));
            }
        }
    }
    None
}

pub fn project_to_stl_legacy(objects: &[CadObject]) -> String {
    let mut stl = String::from("solid cadex\n");
    for object in objects {
        match object {
            CadObject::Wing(wing) => stl.push_str(&wing_to_stl(wing)),
            CadObject::Mesh(mesh) => stl.push_str(&mesh_to_stl(mesh)),
            CadObject::Solid(_) | CadObject::Reference(_) => {}
        }
    }
    stl.push_str("endsolid cadex\n");
    stl
}

pub fn mesh_to_stl(mesh: &MeshObject) -> String {
    let mut out = String::new();
    let triangle_count = mesh.positions.len() / 9;
    for triangle_index in 0..triangle_count {
        let base = triangle_index * 9;
        let a = [
            mesh.positions[base] as f64,
            mesh.positions[base + 1] as f64,
            mesh.positions[base + 2] as f64,
        ];
        let b = [
            mesh.positions[base + 3] as f64,
            mesh.positions[base + 4] as f64,
            mesh.positions[base + 5] as f64,
        ];
        let c = [
            mesh.positions[base + 6] as f64,
            mesh.positions[base + 7] as f64,
            mesh.positions[base + 8] as f64,
        ];
        out.push_str(&facet(a, b, c));
    }
    out
}

pub fn parse_stl(bytes: &[u8], path: &Path) -> Result<MeshObject, String> {
    let source = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("imported.stl")
        .to_string();

    let (positions, normals) = if looks_like_binary_stl(bytes) {
        parse_binary_stl(bytes)?
    } else {
        parse_ascii_stl(bytes)?
    };

    if positions.is_empty() {
        return Err("STL file contained no triangles".to_string());
    }

    let triangle_count = positions.len() / 9;
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Imported mesh")
        .to_string();

    Ok(MeshObject {
        id: Uuid::new_v4().to_string(),
        name: stem,
        source,
        triangle_count,
        positions,
        normals,
    })
}

pub fn looks_like_binary_stl(bytes: &[u8]) -> bool {
    if bytes.len() < 84 {
        return false;
    }
    let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
    let expected = 84usize.saturating_add(count.saturating_mul(50));
    expected == bytes.len()
}

pub fn parse_binary_stl(bytes: &[u8]) -> Result<(Vec<f32>, Vec<f32>), String> {
    let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
    let mut positions = Vec::with_capacity(count * 9);
    let mut normals = Vec::with_capacity(count * 9);
    let mut offset = 84usize;

    let read_f32 = |slice: &[u8], at: usize| -> Result<f32, String> {
        if at + 4 > slice.len() {
            return Err("Truncated binary STL".to_string());
        }
        Ok(f32::from_le_bytes([
            slice[at],
            slice[at + 1],
            slice[at + 2],
            slice[at + 3],
        ]))
    };

    for _ in 0..count {
        if offset + 50 > bytes.len() {
            return Err("Truncated binary STL".to_string());
        }
        let nx = read_f32(bytes, offset)?;
        let ny = read_f32(bytes, offset + 4)?;
        let nz = read_f32(bytes, offset + 8)?;
        for vertex in 0..3 {
            let vo = offset + 12 + vertex * 12;
            positions.push(read_f32(bytes, vo)?);
            positions.push(read_f32(bytes, vo + 4)?);
            positions.push(read_f32(bytes, vo + 8)?);
            normals.push(nx);
            normals.push(ny);
            normals.push(nz);
        }
        offset += 50;
    }
    Ok((positions, normals))
}

pub fn parse_ascii_stl(bytes: &[u8]) -> Result<(Vec<f32>, Vec<f32>), String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "ASCII STL must be valid UTF-8".to_string())?;
    let mut positions: Vec<f32> = Vec::new();
    let mut normals: Vec<f32> = Vec::new();
    let mut current_normal = [0.0f32; 3];

    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("facet normal") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() >= 3 {
                current_normal = [
                    parts[0].parse().unwrap_or(0.0),
                    parts[1].parse().unwrap_or(0.0),
                    parts[2].parse().unwrap_or(0.0),
                ];
            }
        } else if let Some(rest) = trimmed.strip_prefix("vertex") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() >= 3 {
                positions.push(parts[0].parse().unwrap_or(0.0));
                positions.push(parts[1].parse().unwrap_or(0.0));
                positions.push(parts[2].parse().unwrap_or(0.0));
                normals.extend_from_slice(&current_normal);
            }
        }
    }

    if positions.len() % 9 != 0 {
        return Err(format!(
            "ASCII STL contained {} vertex coordinates, which is not a multiple of 9",
            positions.len()
        ));
    }

    Ok((positions, normals))
}

pub fn wing_to_stl(wing: &Wing) -> String {
    let half_span = wing.span_m / 2.0;
    let sections = 32;
    let samples = 48;
    let mut vertices = Vec::new();
    for station in 0..=sections {
        let t = station as f64 / sections as f64;
        let y = -half_span + wing.span_m * t;
        let chord = wing.root_chord_m + (wing.tip_chord_m - wing.root_chord_m) * t.abs();
        let x_offset = y.abs() * wing.sweep_deg.to_radians().tan();
        let z_offset = y.abs() * wing.dihedral_deg.to_radians().tan();
        for sample in 0..samples {
            let u = sample as f64 / samples as f64;
            let (x, z) = naca_4_point(&wing.airfoil, u, chord, sample < samples / 2);
            vertices.push([x + x_offset, y, z + z_offset]);
        }
    }

    let mut out = String::new();
    for station in 0..sections {
        for sample in 0..samples {
            let a = station * samples + sample;
            let b = station * samples + (sample + 1) % samples;
            let c = (station + 1) * samples + sample;
            let d = (station + 1) * samples + (sample + 1) % samples;
            out.push_str(&facet(vertices[a], vertices[c], vertices[b]));
            out.push_str(&facet(vertices[b], vertices[c], vertices[d]));
        }
    }
    out
}

pub fn naca_4_point(airfoil: &str, u: f64, chord: f64, upper: bool) -> (f64, f64) {
    let digits: String = airfoil.chars().filter(|ch| ch.is_ascii_digit()).collect();
    let (m, p, thickness) = if digits.len() == 4 {
        let chars: Vec<f64> = digits
            .chars()
            .filter_map(|ch| ch.to_digit(10).map(|digit| digit as f64))
            .collect();
        (
            chars[0] / 100.0,
            chars[1] / 10.0,
            (chars[2] * 10.0 + chars[3]) / 100.0,
        )
    } else {
        (0.02, 0.4, 0.12)
    };

    let x = if upper { 1.0 - u * 2.0 } else { (u - 0.5) * 2.0 }.clamp(0.0, 1.0);
    let yt = 5.0
        * thickness
        * (0.2969 * x.sqrt() - 0.1260 * x - 0.3516 * x.powi(2) + 0.2843 * x.powi(3)
            - 0.1015 * x.powi(4));
    let (yc, dyc_dx) = if p > 0.0 && x < p {
        (
            m / p.powi(2) * (2.0 * p * x - x.powi(2)),
            2.0 * m / p.powi(2) * (p - x),
        )
    } else if p > 0.0 {
        (
            m / (1.0 - p).powi(2) * ((1.0 - 2.0 * p) + 2.0 * p * x - x.powi(2)),
            2.0 * m / (1.0 - p).powi(2) * (p - x),
        )
    } else {
        (0.0, 0.0)
    };
    let theta = dyc_dx.atan();
    let sign = if upper { 1.0 } else { -1.0 };
    (
        (x - sign * yt * theta.sin()) * chord,
        (yc + sign * yt * theta.cos()) * chord,
    )
}

pub fn facet(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> String {
    let normal = triangle_normal(a, b, c);
    format!(
        "  facet normal {} {} {}\n    outer loop\n      vertex {} {} {}\n      vertex {} {} {}\n      vertex {} {} {}\n    endloop\n  endfacet\n",
        normal[0], normal[1], normal[2],
        a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]
    )
}

pub fn triangle_normal(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> [f64; 3] {
    let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];
    let length = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    if length > 0.0 {
        [n[0] / length, n[1] / length, n[2] / length]
    } else {
        [0.0, 0.0, 0.0]
    }
}

pub fn project_to_openvsp_script(objects: &[CadObject], step_path: &PathBuf) -> String {
    let mut script = String::from("void main()\n{\n    ClearVSPModel();\n");
    for object in objects {
        match object {
            CadObject::Wing(wing) => {
                let half_span = wing.span_m / 2.0;
                let sym_value = if wing.symmetry { 2 } else { 0 };
                let safe_name = wing.name.replace('"', "\\\"");
                script.push_str(&format!(
                    concat!(
                        "    string wid = AddGeom(\"WING\");\n",
                        "    SetGeomName(wid, \"{name}\");\n",
                        "    SetParmVal(wid, \"Sym_Planar_Flag\", \"Sym\", {sym});\n",
                        "    SetDriverGroup(wid, 1, SPAN_WSECT_DRIVER, ROOTC_WSECT_DRIVER, TIPC_WSECT_DRIVER);\n",
                        "    SetParmVal(wid, \"Span\", \"XSec_1\", {half_span});\n",
                        "    SetParmVal(wid, \"Root_Chord\", \"XSec_1\", {root});\n",
                        "    SetParmVal(wid, \"Tip_Chord\", \"XSec_1\", {tip});\n",
                        "    SetParmVal(wid, \"Sweep\", \"XSec_1\", {sweep});\n",
                        "    SetParmVal(wid, \"Dihedral\", \"XSec_1\", {dihedral});\n",
                        "    SetParmVal(wid, \"Twist\", \"XSec_1\", {twist});\n",
                        "    Update();\n",
                    ),
                    name = safe_name,
                    sym = sym_value,
                    half_span = half_span,
                    root = wing.root_chord_m,
                    tip = wing.tip_chord_m,
                    sweep = wing.sweep_deg,
                    dihedral = wing.dihedral_deg,
                    twist = wing.twist_deg,
                ));
            }
            CadObject::Mesh(_) => {
                script.push_str("    // Imported mesh objects are skipped for OpenVSP STEP export.\n");
            }
            CadObject::Solid(_) => {
                script.push_str("    // Cadrum solids are exported through the cadrum STEP path, not OpenVSP.\n");
            }
            CadObject::Reference(_) => {
                script.push_str("    // Reference geometry is construction-only and skipped for OpenVSP STEP export.\n");
            }
        }
    }
    script.push_str(&format!(
        "    Update();\n    ExportFile(\"{}\", SET_ALL, EXPORT_STEP);\n}}\n",
        step_path.display()
    ));
    script
}

pub fn find_openvsp_binary() -> Option<String> {
    ["vsp", "openvsp", "vsp.exe", "OpenVSP"]
        .iter()
        .find(|candidate| Command::new(candidate).arg("-help").output().is_ok())
        .map(|candidate| candidate.to_string())
}

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect();
    if cleaned.is_empty() {
        "cadex_export".to_string()
    } else {
        cleaned
    }
}

pub fn wing_from_tool_args(value: &serde_json::Value) -> Result<Wing, String> {
    Ok(Wing {
        id: Uuid::new_v4().to_string(),
        name: value
            .get("name")
            .and_then(|name| name.as_str())
            .unwrap_or("AI wing")
            .to_string(),
        span_m: value
            .get("span_m")
            .and_then(|number| number.as_f64())
            .ok_or("create_wing.span_m is required")?,
        root_chord_m: value
            .get("root_chord_m")
            .and_then(|number| number.as_f64())
            .ok_or("create_wing.root_chord_m is required")?,
        tip_chord_m: value
            .get("tip_chord_m")
            .and_then(|number| number.as_f64())
            .unwrap_or_else(|| value.get("root_chord_m").and_then(|number| number.as_f64()).unwrap_or(0.2)),
        sweep_deg: value.get("sweep_deg").and_then(|n| n.as_f64()).unwrap_or(0.0),
        dihedral_deg: value.get("dihedral_deg").and_then(|n| n.as_f64()).unwrap_or(0.0),
        twist_deg: value.get("twist_deg").and_then(|n| n.as_f64()).unwrap_or(0.0),
        airfoil: value
            .get("airfoil")
            .and_then(|name| name.as_str())
            .unwrap_or("NACA 2412")
            .to_string(),
        symmetry: value.get("symmetry").and_then(|f| f.as_bool()).unwrap_or(true),
    })
}
