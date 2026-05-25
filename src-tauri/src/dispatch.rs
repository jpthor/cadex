//! Wires the OpenAI tool-call payloads into the cadrum-backed kernel and the
//! legacy aircraft / reference path. Returns updated `CadProject` state plus
//! a human-readable summary of what each call did.

use serde_json::Value;
use uuid::Uuid;

use crate::cad::types::Vec3;
use crate::cad::{features, io as kio, primitives, transforms, KernelState};
use crate::legacy;
use crate::model::{
    CadObject, CadProject, ReferenceGeometry, SolidObject, TimelineEvent, Wing,
};
use crate::tools::{lookup, Implementation};

/// Result of executing a single tool call.
pub struct ToolOutcome {
    pub project: CadProject,
    pub message: String,
}

pub fn run_tool(
    state: &KernelState,
    project: CadProject,
    name: &str,
    args: &Value,
    selected: Option<&Value>,
) -> Result<ToolOutcome, String> {
    let descriptor = lookup(name);

    let implementation = descriptor
        .as_ref()
        .map(|d| d.implementation)
        .unwrap_or(Implementation::Stub);

    if matches!(implementation, Implementation::Stub) {
        let mut next = project;
        let label = format!("[stub] {name}");
        let detail = format!(
            "{name} called with {} arguments — not yet implemented in V1.",
            args.as_object().map(|o| o.len()).unwrap_or(0)
        );
        next.timeline.push(TimelineEvent {
            id: Uuid::new_v4().to_string(),
            label,
            detail: detail.clone(),
        });
        return Ok(ToolOutcome {
            project: next,
            message: detail,
        });
    }

    match name {
        "create_box" => create_box_call(state, project, args),
        "create_cylinder" => create_cylinder_call(state, project, args),
        "create_sphere" => create_sphere_call(state, project, args),
        "create_cone" => create_cone_call(state, project, args),
        "create_torus" => create_torus_call(state, project, args),
        "extrude_polygon" => extrude_polygon_call(state, project, args),
        "extrude_circle" => extrude_circle_call(state, project, args),
        "loft_polygons" => loft_polygons_call(state, project, args),
        "sweep_polygon" => sweep_polygon_call(state, project, args),
        "boolean_union" => boolean_call(state, project, args, BooleanOp::Union),
        "boolean_subtract" => boolean_call(state, project, args, BooleanOp::Subtract),
        "boolean_intersect" => boolean_call(state, project, args, BooleanOp::Intersect),
        "fillet_edges" => fillet_call(state, project, args),
        "chamfer_edges" => chamfer_call(state, project, args),
        "shell_solid" => shell_call(state, project, args),
        "translate_solid" => translate_call(state, project, args),
        "rotate_solid" => rotate_call(state, project, args),
        "scale_solid" => scale_call(state, project, args),
        "mirror_solid" => mirror_call(state, project, args),
        "copy_solid" => copy_call(state, project, args),
        "create_reference_geometry" => reference_call(project, args, selected),
        "inspect_geometry" => inspect_call(project, args),
        "list_objects" => list_objects_call(project),
        "delete_object" => delete_object_call(state, project, args),
        "rename_object" => rename_object_call(project, args),
        "export_step" => export_step_call(state, project, args),
        "export_stl" => export_stl_call(state, project, args),
        "create_wing" => create_wing_call(project, args),
        "update_wing_parameters" => update_wing_call(project, args),
        "set_airfoil" => set_airfoil_call(project, args),
        other => Err(format!("Unknown tool '{other}'")),
    }
}

// ----------------------------------------------------------------------------
// Solid primitives
// ----------------------------------------------------------------------------

fn create_box_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let size = require_vec3(args, "size_m")?;
    let center = optional_vec3(args, "center_m");
    let handle = primitives::create_box(state, size, center).map_err(|e| e.to_string())?;
    let name = string_or(args, "name", "Box");
    finish_solid(state, &mut project, &handle, &name, &format!(
        "create_box {:.3}×{:.3}×{:.3} m", size[0], size[1], size[2]
    ))
}

fn create_cylinder_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let radius = require_f64(args, "radius_m")?;
    let height = require_f64(args, "height_m")?;
    let axis = optional_vec3(args, "axis").unwrap_or([0.0, 0.0, 1.0]);
    let center = optional_vec3(args, "center_m");
    let handle = primitives::create_cylinder(state, radius, axis, height, center).map_err(|e| e.to_string())?;
    let name = string_or(args, "name", "Cylinder");
    finish_solid(state, &mut project, &handle, &name, &format!(
        "create_cylinder r={radius:.3} h={height:.3}"
    ))
}

fn create_sphere_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let radius = require_f64(args, "radius_m")?;
    let center = optional_vec3(args, "center_m");
    let handle = primitives::create_sphere(state, radius, center).map_err(|e| e.to_string())?;
    let name = string_or(args, "name", "Sphere");
    finish_solid(state, &mut project, &handle, &name, &format!("create_sphere r={radius:.3}"))
}

fn create_cone_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let base = require_f64(args, "base_radius_m")?;
    let top = require_f64(args, "top_radius_m")?;
    let height = require_f64(args, "height_m")?;
    let axis = optional_vec3(args, "axis").unwrap_or([0.0, 0.0, 1.0]);
    let center = optional_vec3(args, "center_m");
    let handle = primitives::create_cone(state, base, top, axis, height, center).map_err(|e| e.to_string())?;
    let name = string_or(args, "name", "Cone");
    finish_solid(state, &mut project, &handle, &name, &format!(
        "create_cone base={base:.3} top={top:.3} h={height:.3}"
    ))
}

fn create_torus_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let major = require_f64(args, "major_radius_m")?;
    let minor = require_f64(args, "minor_radius_m")?;
    let axis = optional_vec3(args, "axis").unwrap_or([0.0, 0.0, 1.0]);
    let center = optional_vec3(args, "center_m");
    let handle = primitives::create_torus(state, major, minor, axis, center).map_err(|e| e.to_string())?;
    let name = string_or(args, "name", "Torus");
    finish_solid(state, &mut project, &handle, &name, &format!(
        "create_torus R={major:.3} r={minor:.3}"
    ))
}

// ----------------------------------------------------------------------------
// Features
// ----------------------------------------------------------------------------

fn extrude_polygon_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let points = require_vec3_array(args, "profile_points")?;
    let direction = require_vec3(args, "direction_m")?;
    let handle = features::extrude_polygon(state, &points, direction).map_err(|e| e.to_string())?;
    let name = string_or(args, "name", "Extrude");
    finish_solid(state, &mut project, &handle, &name, &format!(
        "extrude_polygon points={} dir=[{:.3},{:.3},{:.3}]",
        points.len(), direction[0], direction[1], direction[2]
    ))
}

fn extrude_circle_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let radius = require_f64(args, "radius_m")?;
    let center = require_vec3(args, "center_m")?;
    let axis = require_vec3(args, "axis")?;
    let direction = require_vec3(args, "direction_m")?;
    let handle = features::extrude_circle(state, radius, center, axis, direction).map_err(|e| e.to_string())?;
    let name = string_or(args, "name", "Extrude (circle)");
    finish_solid(state, &mut project, &handle, &name, &format!("extrude_circle r={radius:.3}"))
}

fn loft_polygons_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let raw = args
        .get("sections")
        .and_then(|v| v.as_array())
        .ok_or("loft_polygons.sections is required")?;
    let mut sections: Vec<Vec<Vec3>> = Vec::with_capacity(raw.len());
    for s in raw {
        let pts = parse_vec3_array(s)?;
        sections.push(pts);
    }
    let handle = features::loft_polygons(state, &sections).map_err(|e| e.to_string())?;
    let name = string_or(args, "name", "Loft");
    finish_solid(state, &mut project, &handle, &name, &format!("loft_polygons sections={}", sections.len()))
}

fn sweep_polygon_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let profile = require_vec3_array(args, "profile_points")?;
    let spine = require_vec3_array(args, "spine_points")?;
    let up = optional_vec3(args, "up_axis");
    let handle = features::sweep_polygon(state, &profile, &spine, up).map_err(|e| e.to_string())?;
    let name = string_or(args, "name", "Sweep");
    finish_solid(state, &mut project, &handle, &name, &format!(
        "sweep_polygon profile={} spine={}", profile.len(), spine.len()
    ))
}

#[derive(Clone, Copy)]
enum BooleanOp { Union, Subtract, Intersect }

fn boolean_call(
    state: &KernelState,
    mut project: CadProject,
    args: &Value,
    op: BooleanOp,
) -> Result<ToolOutcome, String> {
    let target_id = require_str(args, "target_id")?;
    let tool_ids = args
        .get("tool_ids")
        .and_then(|v| v.as_array())
        .ok_or("tool_ids is required")?;
    let tool_object_ids: Vec<&str> = tool_ids
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    let target_handle = handle_for_object(&project, target_id)
        .ok_or_else(|| format!("target '{target_id}' is not a kernel solid"))?
        .to_string();
    let mut tool_handles = Vec::with_capacity(tool_object_ids.len());
    for tid in &tool_object_ids {
        let h = handle_for_object(&project, tid)
            .ok_or_else(|| format!("tool '{tid}' is not a kernel solid"))?
            .to_string();
        tool_handles.push(h);
    }
    let result_handle = match op {
        BooleanOp::Union => crate::cad::booleans::union(state, &target_handle, &tool_handles),
        BooleanOp::Subtract => crate::cad::booleans::subtract(state, &target_handle, &tool_handles),
        BooleanOp::Intersect => crate::cad::booleans::intersect(state, &target_handle, &tool_handles),
    }
    .map_err(|e| e.to_string())?;

    project.objects.retain(|o| !tool_object_ids.iter().any(|tid| *tid == o.id()));

    let mesh = crate::cad::tessellate::tessellate(state, &result_handle, None)
        .map_err(|e| e.to_string())?;
    let target_label = match op {
        BooleanOp::Union => "Union",
        BooleanOp::Subtract => "Subtract",
        BooleanOp::Intersect => "Intersect",
    };
    if let Some(target) = project.objects.iter_mut().find(|o| o.id() == target_id) {
        if let CadObject::Solid(s) = target {
            s.kernel_handle = result_handle.clone();
            s.triangle_count = mesh.triangle_count;
            s.positions = mesh.positions;
            s.normals = mesh.normals;
            s.source = format!("boolean_{}", target_label.to_lowercase());
        }
    }
    let detail = format!(
        "{target_label}: target {target_id} with {} tool(s)",
        tool_object_ids.len()
    );
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: target_label.to_string(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: detail })
}

fn fillet_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let target_id = require_str(args, "target_id")?;
    let radius = require_f64(args, "radius_m")?;
    let handle = handle_for_object(&project, target_id)
        .ok_or_else(|| format!("target '{target_id}' is not a kernel solid"))?
        .to_string();
    features::fillet_all_edges(state, &handle, radius).map_err(|e| e.to_string())?;
    refresh_solid_mesh(state, &mut project, target_id, &handle, "fillet_edges")?;
    let detail = format!("fillet_edges {target_id} r={radius:.3}");
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "Fillet edges".into(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: detail })
}

fn chamfer_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let target_id = require_str(args, "target_id")?;
    let distance = require_f64(args, "distance_m")?;
    let handle = handle_for_object(&project, target_id)
        .ok_or_else(|| format!("target '{target_id}' is not a kernel solid"))?
        .to_string();
    features::chamfer_all_edges(state, &handle, distance).map_err(|e| e.to_string())?;
    refresh_solid_mesh(state, &mut project, target_id, &handle, "chamfer_edges")?;
    let detail = format!("chamfer_edges {target_id} d={distance:.3}");
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "Chamfer edges".into(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: detail })
}

fn shell_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let target_id = require_str(args, "target_id")?;
    let thickness = require_f64(args, "thickness_m")?;
    let open_all = args.get("open_all_faces").and_then(|v| v.as_bool()).unwrap_or(false);
    let handle = handle_for_object(&project, target_id)
        .ok_or_else(|| format!("target '{target_id}' is not a kernel solid"))?
        .to_string();
    features::shell_solid(state, &handle, thickness, open_all).map_err(|e| e.to_string())?;
    refresh_solid_mesh(state, &mut project, target_id, &handle, "shell_solid")?;
    let detail = format!("shell_solid {target_id} t={thickness:.3} open_all={open_all}");
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "Shell".into(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: detail })
}

// ----------------------------------------------------------------------------
// Transforms
// ----------------------------------------------------------------------------

fn translate_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let target_id = require_str(args, "target_id")?;
    let delta = require_vec3(args, "delta_m")?;
    let handle = handle_for_object(&project, target_id)
        .ok_or_else(|| format!("target '{target_id}' is not a kernel solid"))?
        .to_string();
    transforms::translate(state, &handle, delta).map_err(|e| e.to_string())?;
    refresh_solid_mesh(state, &mut project, target_id, &handle, "translate_solid")?;
    let detail = format!("translate_solid {target_id} delta=[{:.3},{:.3},{:.3}]", delta[0], delta[1], delta[2]);
    project.timeline.push(TimelineEvent { id: Uuid::new_v4().to_string(), label: "Translate".into(), detail: detail.clone() });
    Ok(ToolOutcome { project, message: detail })
}

fn rotate_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let target_id = require_str(args, "target_id")?;
    let axis = require_vec3(args, "axis")?;
    let angle_deg = require_f64(args, "angle_deg")?;
    let handle = handle_for_object(&project, target_id)
        .ok_or_else(|| format!("target '{target_id}' is not a kernel solid"))?
        .to_string();
    transforms::rotate(state, &handle, axis, angle_deg.to_radians()).map_err(|e| e.to_string())?;
    refresh_solid_mesh(state, &mut project, target_id, &handle, "rotate_solid")?;
    let detail = format!("rotate_solid {target_id} angle={angle_deg:.1}°");
    project.timeline.push(TimelineEvent { id: Uuid::new_v4().to_string(), label: "Rotate".into(), detail: detail.clone() });
    Ok(ToolOutcome { project, message: detail })
}

fn scale_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let target_id = require_str(args, "target_id")?;
    let factor = require_f64(args, "factor")?;
    let pivot = optional_vec3(args, "pivot_m").unwrap_or([0.0, 0.0, 0.0]);
    let handle = handle_for_object(&project, target_id)
        .ok_or_else(|| format!("target '{target_id}' is not a kernel solid"))?
        .to_string();
    transforms::scale(state, &handle, pivot, factor).map_err(|e| e.to_string())?;
    refresh_solid_mesh(state, &mut project, target_id, &handle, "scale_solid")?;
    let detail = format!("scale_solid {target_id} factor={factor:.3}");
    project.timeline.push(TimelineEvent { id: Uuid::new_v4().to_string(), label: "Scale".into(), detail: detail.clone() });
    Ok(ToolOutcome { project, message: detail })
}

fn mirror_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let target_id = require_str(args, "target_id")?;
    let normal = require_vec3(args, "plane_normal")?;
    let origin = optional_vec3(args, "plane_origin_m").unwrap_or([0.0, 0.0, 0.0]);
    let handle = handle_for_object(&project, target_id)
        .ok_or_else(|| format!("target '{target_id}' is not a kernel solid"))?
        .to_string();
    transforms::mirror(state, &handle, origin, normal).map_err(|e| e.to_string())?;
    refresh_solid_mesh(state, &mut project, target_id, &handle, "mirror_solid")?;
    let detail = format!("mirror_solid {target_id}");
    project.timeline.push(TimelineEvent { id: Uuid::new_v4().to_string(), label: "Mirror".into(), detail: detail.clone() });
    Ok(ToolOutcome { project, message: detail })
}

fn copy_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let target_id = require_str(args, "target_id")?;
    let delta = optional_vec3(args, "delta_m");
    let source_handle = handle_for_object(&project, target_id)
        .ok_or_else(|| format!("target '{target_id}' is not a kernel solid"))?
        .to_string();
    let cloned = state.clone_solid(&source_handle).map_err(|e| e.to_string())?;
    let new_handle = state.insert(cloned).map_err(|e| e.to_string())?;
    if let Some(d) = delta {
        transforms::translate(state, &new_handle, d).map_err(|e| e.to_string())?;
    }
    let source_name = project
        .objects
        .iter()
        .find(|o| o.id() == target_id)
        .map(|o| o.name().to_string())
        .unwrap_or_else(|| "Solid".into());
    let new_name = format!("{} copy", source_name);
    finish_solid(state, &mut project, &new_handle, &new_name, &format!("copy_solid from {target_id}"))
}

// ----------------------------------------------------------------------------
// Reference / inspect / project housekeeping
// ----------------------------------------------------------------------------

fn reference_call(mut project: CadProject, args: &Value, selected: Option<&Value>) -> Result<ToolOutcome, String> {
    let kind = args
        .get("reference_kind")
        .and_then(|v| v.as_str())
        .ok_or("reference_kind is required")?
        .to_string();
    if !matches!(kind.as_str(), "plane" | "point" | "line" | "face" | "surface") {
        return Err("reference_kind is invalid".into());
    }
    let selected_origin = selected
        .and_then(|s| s.get("position"))
        .and_then(parse_vec3_value);
    let selected_normal = selected
        .and_then(|s| s.get("normal"))
        .and_then(parse_vec3_value);
    let origin = optional_vec3(args, "origin")
        .or(selected_origin)
        .unwrap_or([0.0, 0.0, 0.0]);
    let normal = optional_vec3(args, "normal").or(selected_normal).or_else(|| {
        if matches!(kind.as_str(), "plane" | "face" | "surface") {
            Some([0.0, 1.0, 0.0])
        } else {
            None
        }
    });
    let end = optional_vec3(args, "end");
    let size = args.get("size_m").and_then(|v| v.as_f64()).or(Some(0.18));
    let reference = ReferenceGeometry {
        id: Uuid::new_v4().to_string(),
        name: string_or(args, "name", &format!("{kind} reference")),
        reference_kind: kind.clone(),
        origin: origin.to_vec(),
        normal: normal.map(|n| n.to_vec()),
        end: end.map(|e| e.to_vec()),
        size_m: size,
        source_selection: selected.cloned(),
    };
    let detail = format!(
        "{} at {:.3}, {:.3}, {:.3}",
        kind, origin[0], origin[1], origin[2]
    );
    project.objects.push(CadObject::Reference(reference));
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "Reference geometry".into(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: detail })
}

fn inspect_call(project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let id = args.get("id").and_then(|v| v.as_str());
    let summary = describe_geometry(&project, id);
    Ok(ToolOutcome { project, message: summary })
}

fn list_objects_call(project: CadProject) -> Result<ToolOutcome, String> {
    let lines: Vec<String> = project
        .objects
        .iter()
        .map(|o| format!("{}: {} ({})", o.id(), o.name(), kind_label(o)))
        .collect();
    let summary = if lines.is_empty() {
        "Project is empty.".to_string()
    } else {
        lines.join(" | ")
    };
    Ok(ToolOutcome { project, message: summary })
}

fn delete_object_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let id = require_str(args, "id")?;
    let kept: Vec<CadObject> = project.objects.iter().filter(|o| o.id() != id).cloned().collect();
    let removed = project.objects.len() - kept.len();
    if removed == 0 {
        return Err(format!("no object with id '{id}'"));
    }
    let removed_handle = project
        .objects
        .iter()
        .find(|o| o.id() == id)
        .and_then(|o| o.kernel_handle())
        .map(|h| h.to_string());
    project.objects = kept;
    if let Some(h) = removed_handle {
        let _ = state.remove(&h);
    }
    let detail = format!("deleted {id}");
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "Delete".into(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: detail })
}

fn rename_object_call(mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let id = require_str(args, "id")?;
    let name = require_str(args, "name")?;
    let target = project.objects.iter_mut().find(|o| o.id() == id);
    let target = target.ok_or_else(|| format!("no object with id '{id}'"))?;
    target.set_name(name.to_string());
    let detail = format!("renamed {id} -> {name}");
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "Rename".into(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: detail })
}

fn export_step_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let path = args.get("path").and_then(|v| v.as_str())
        .ok_or("export_step.path is required (the desktop UI normally provides one)")?;
    let handles: Vec<String> = project
        .objects
        .iter()
        .filter_map(|o| o.kernel_handle().map(|h| h.to_string()))
        .collect();
    if handles.is_empty() {
        return Err("no kernel solids to export".into());
    }
    kio::write_step(state, &handles, std::path::Path::new(path)).map_err(|e| e.to_string())?;
    let detail = format!("STEP exported via cadrum to {path}");
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "STEP export".into(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: detail })
}

fn export_stl_call(state: &KernelState, mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let path = args.get("path").and_then(|v| v.as_str())
        .ok_or("export_stl.path is required")?;
    let deflection = args.get("deflection_m").and_then(|v| v.as_f64()).unwrap_or(0.0005);
    let handles: Vec<String> = project
        .objects
        .iter()
        .filter_map(|o| o.kernel_handle().map(|h| h.to_string()))
        .collect();
    if handles.is_empty() {
        return Err("no kernel solids to export".into());
    }
    kio::write_stl(state, &handles, std::path::Path::new(path), deflection).map_err(|e| e.to_string())?;
    let detail = format!("STL exported via cadrum to {path}");
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "STL export".into(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: detail })
}

// ----------------------------------------------------------------------------
// Aircraft path (legacy V1)
// ----------------------------------------------------------------------------

fn create_wing_call(mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let wing = legacy::wing_from_tool_args(args)?;
    let detail = format!(
        "{} m span, {} m chord, {} airfoil",
        wing.span_m, wing.root_chord_m, wing.airfoil
    );
    project.objects.push(CadObject::Wing(wing));
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "AI generated wing".into(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome { project, message: format!("Created wing ({detail}).") })
}

fn update_wing_call(mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let id = args.get("id").and_then(|v| v.as_str());
    let index = find_wing_index(&project, id).ok_or("No wing to update")?;
    let summary = apply_wing_updates(&mut project, index, args);
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "Updated wing".into(),
        detail: summary.clone(),
    });
    Ok(ToolOutcome { project, message: format!("Updated wing: {summary}.") })
}

fn set_airfoil_call(mut project: CadProject, args: &Value) -> Result<ToolOutcome, String> {
    let id = args.get("id").and_then(|v| v.as_str());
    let airfoil = require_str(args, "airfoil")?.to_string();
    let index = find_wing_index(&project, id).ok_or("No wing to update")?;
    if let CadObject::Wing(wing) = &mut project.objects[index] {
        wing.airfoil = airfoil.clone();
    }
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: "Set airfoil".into(),
        detail: airfoil.clone(),
    });
    Ok(ToolOutcome { project, message: format!("Set airfoil to {airfoil}.") })
}

pub fn find_wing_index(project: &CadProject, id: Option<&str>) -> Option<usize> {
    let mut last = None;
    for (idx, object) in project.objects.iter().enumerate() {
        if let CadObject::Wing(wing) = object {
            last = Some(idx);
            if let Some(target) = id {
                if wing.id == target {
                    return Some(idx);
                }
            }
        }
    }
    if id.is_none() { last } else { None }
}

pub fn apply_wing_updates(project: &mut CadProject, index: usize, args: &Value) -> String {
    let Some(wing) = (match &mut project.objects[index] {
        CadObject::Wing(wing) => Some(wing),
        _ => None,
    }) else {
        return "no changes".to_string();
    };
    let mut changes: Vec<String> = Vec::new();
    if let Some(name) = args.get("name").and_then(|v| v.as_str()) {
        wing.name = name.to_string();
        changes.push(format!("name={name}"));
    }
    for (key, label) in [
        ("span_m", "span"),
        ("root_chord_m", "root chord"),
        ("tip_chord_m", "tip chord"),
        ("sweep_deg", "sweep"),
        ("dihedral_deg", "dihedral"),
        ("twist_deg", "twist"),
    ] {
        if let Some(value) = args.get(key).and_then(|v| v.as_f64()) {
            match key {
                "span_m" => wing.span_m = value,
                "root_chord_m" => wing.root_chord_m = value,
                "tip_chord_m" => wing.tip_chord_m = value,
                "sweep_deg" => wing.sweep_deg = value,
                "dihedral_deg" => wing.dihedral_deg = value,
                "twist_deg" => wing.twist_deg = value,
                _ => {}
            }
            changes.push(format!("{label}={value}"));
        }
    }
    if let Some(value) = args.get("symmetry").and_then(|v| v.as_bool()) {
        wing.symmetry = value;
        changes.push(format!("symmetry={value}"));
    }
    if changes.is_empty() { "no changes".into() } else { changes.join(", ") }
}

pub fn describe_geometry(project: &CadProject, id: Option<&str>) -> String {
    if let Some(target) = id {
        for object in &project.objects {
            if object.id() == target {
                return describe_object(object);
            }
        }
        return format!("No object with id '{target}'.");
    }
    if project.objects.is_empty() {
        return "No geometry in the project yet.".to_string();
    }
    project
        .objects
        .iter()
        .map(describe_object)
        .collect::<Vec<_>>()
        .join(" | ")
}

fn describe_object(object: &CadObject) -> String {
    match object {
        CadObject::Wing(w) => describe_wing(w),
        CadObject::Mesh(m) => format!("{}: imported mesh ({} triangles)", m.name, m.triangle_count),
        CadObject::Solid(s) => format!("{}: cadrum solid ({} triangles, source {})", s.name, s.triangle_count, s.source),
        CadObject::Reference(r) => format!("{}: {} reference", r.name, r.reference_kind),
    }
}

fn describe_wing(wing: &Wing) -> String {
    format!(
        "{}: span {:.3} m, root {:.3} m, tip {:.3} m, sweep {:.1}°, dihedral {:.1}°, twist {:.1}°, airfoil {}",
        wing.name, wing.span_m, wing.root_chord_m, wing.tip_chord_m,
        wing.sweep_deg, wing.dihedral_deg, wing.twist_deg, wing.airfoil
    )
}

fn kind_label(object: &CadObject) -> &'static str {
    match object {
        CadObject::Wing(_) => "wing",
        CadObject::Mesh(_) => "mesh",
        CadObject::Solid(_) => "solid",
        CadObject::Reference(_) => "reference",
    }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

fn finish_solid(
    state: &KernelState,
    project: &mut CadProject,
    handle: &str,
    name: &str,
    source: &str,
) -> Result<ToolOutcome, String> {
    let mesh = crate::cad::tessellate::tessellate(state, &handle.to_string(), None)
        .map_err(|e| e.to_string())?;
    let solid = SolidObject {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        source: source.to_string(),
        kernel_handle: handle.to_string(),
        triangle_count: mesh.triangle_count,
        positions: mesh.positions,
        normals: mesh.normals,
    };
    let solid_id = solid.id.clone();
    let detail = format!("{name} ({source}, {} triangles)", solid.triangle_count);
    project.objects.push(CadObject::Solid(solid));
    project.timeline.push(TimelineEvent {
        id: Uuid::new_v4().to_string(),
        label: name.to_string(),
        detail: detail.clone(),
    });
    Ok(ToolOutcome {
        project: CadProject {
            id: project.id.clone(),
            name: project.name.clone(),
            units: project.units.clone(),
            objects: project.objects.clone(),
            timeline: project.timeline.clone(),
        },
        message: format!("{detail} (id={solid_id})"),
    })
}

fn refresh_solid_mesh(
    state: &KernelState,
    project: &mut CadProject,
    object_id: &str,
    handle: &str,
    source_label: &str,
) -> Result<(), String> {
    let mesh = crate::cad::tessellate::tessellate(state, &handle.to_string(), None)
        .map_err(|e| e.to_string())?;
    if let Some(target) = project.objects.iter_mut().find(|o| o.id() == object_id) {
        if let CadObject::Solid(s) = target {
            s.kernel_handle = handle.to_string();
            s.triangle_count = mesh.triangle_count;
            s.positions = mesh.positions;
            s.normals = mesh.normals;
            s.source = source_label.to_string();
        }
    }
    Ok(())
}

fn handle_for_object<'a>(project: &'a CadProject, id: &str) -> Option<&'a str> {
    project.objects.iter().find(|o| o.id() == id).and_then(|o| o.kernel_handle())
}

fn require_f64(value: &Value, key: &str) -> Result<f64, String> {
    value
        .get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| format!("{key} is required"))
}

fn require_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("{key} is required"))
}

fn require_vec3(value: &Value, key: &str) -> Result<Vec3, String> {
    parse_vec3_value(value.get(key).ok_or_else(|| format!("{key} is required"))?)
        .ok_or_else(|| format!("{key} must be a 3-element number array"))
}

fn optional_vec3(value: &Value, key: &str) -> Option<Vec3> {
    value.get(key).and_then(parse_vec3_value)
}

fn require_vec3_array(value: &Value, key: &str) -> Result<Vec<Vec3>, String> {
    parse_vec3_array(value.get(key).ok_or_else(|| format!("{key} is required"))?)
}

fn parse_vec3_array(raw: &Value) -> Result<Vec<Vec3>, String> {
    let arr = raw.as_array().ok_or("expected an array of [x,y,z] points")?;
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        out.push(parse_vec3_value(entry).ok_or("expected [x,y,z]")?);
    }
    Ok(out)
}

fn parse_vec3_value(value: &Value) -> Option<Vec3> {
    let arr = value.as_array()?;
    if arr.len() < 3 {
        return None;
    }
    let x = arr[0].as_f64()?;
    let y = arr[1].as_f64()?;
    let z = arr[2].as_f64()?;
    Some([x, y, z])
}

fn string_or(value: &Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| fallback.to_string())
}
