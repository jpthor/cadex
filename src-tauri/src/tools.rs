//! CAD tool catalog. Every tool is defined here, regardless of whether it is
//! actually implemented yet, so the AI copilot has visibility of the full
//! design surface. Implemented tools dispatch to the kernel; the rest report
//! back a "not yet implemented" status string the AI can reason about.

use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCategory {
    Sketching,
    SolidModelling,
    SurfaceModelling,
    SheetMetal,
    Reference,
    Transform,
    Inspection,
    FileIo,
}

impl ToolCategory {
    pub fn label(self) -> &'static str {
        match self {
            ToolCategory::Sketching => "sketching",
            ToolCategory::SolidModelling => "solid_modelling",
            ToolCategory::SurfaceModelling => "surface_modelling",
            ToolCategory::SheetMetal => "sheet_metal",
            ToolCategory::Reference => "reference",
            ToolCategory::Transform => "transform",
            ToolCategory::Inspection => "inspection",
            ToolCategory::FileIo => "file_io",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Implementation {
    Implemented,
    Stub,
}

#[derive(Debug, Clone)]
pub struct ToolDescriptor {
    pub name: &'static str,
    pub category: ToolCategory,
    pub implementation: Implementation,
    pub description: &'static str,
    pub parameters: fn() -> Value,
}

impl ToolDescriptor {
    pub fn to_openai_schema(&self) -> Value {
        json!({
            "type": "function",
            "name": self.name,
            "description": format!(
                "[{cat}] {desc}{stub}",
                cat = self.category.label(),
                desc = self.description,
                stub = if matches!(self.implementation, Implementation::Stub) {
                    " (NOT YET IMPLEMENTED — call to register intent; the system will report it as a stub.)"
                } else {
                    ""
                }
            ),
            "parameters": (self.parameters)(),
            "strict": false,
        })
    }
}

fn vec3_property(description: &str) -> Value {
    json!({
        "type": "array",
        "items": { "type": "number" },
        "minItems": 3,
        "maxItems": 3,
        "description": description,
    })
}

fn handle_property(description: &str) -> Value {
    json!({ "type": "string", "description": description })
}

fn polygon_property(description: &str) -> Value {
    json!({
        "type": "array",
        "items": {
            "type": "array",
            "items": { "type": "number" },
            "minItems": 3,
            "maxItems": 3,
        },
        "minItems": 3,
        "description": description,
    })
}

fn empty_object() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
}

// =============================================================================
// Schema generators (one per tool). Kept as small fns so the descriptor table
// can stay flat and `static`-friendly.
// =============================================================================

fn schema_create_box() -> Value {
    json!({
        "type": "object",
        "properties": {
            "size_m": vec3_property("Box dimensions [x, y, z] in metres."),
            "center_m": vec3_property("Optional centre of the box in metres. Defaults to the box minimum corner at the origin."),
            "name": { "type": "string" }
        },
        "required": ["size_m"],
        "additionalProperties": false
    })
}
fn schema_create_cylinder() -> Value {
    json!({
        "type": "object",
        "properties": {
            "radius_m": { "type": "number", "description": "Radius in metres." },
            "height_m": { "type": "number", "description": "Height in metres along the axis." },
            "axis": vec3_property("Axis direction (defaults to [0,0,1])."),
            "center_m": vec3_property("Optional anchor point in metres."),
            "name": { "type": "string" }
        },
        "required": ["radius_m", "height_m"],
        "additionalProperties": false
    })
}
fn schema_create_sphere() -> Value {
    json!({
        "type": "object",
        "properties": {
            "radius_m": { "type": "number" },
            "center_m": vec3_property("Optional centre."),
            "name": { "type": "string" }
        },
        "required": ["radius_m"],
        "additionalProperties": false
    })
}
fn schema_create_cone() -> Value {
    json!({
        "type": "object",
        "properties": {
            "base_radius_m": { "type": "number" },
            "top_radius_m": { "type": "number", "description": "Use 0 for a sharp cone." },
            "height_m": { "type": "number" },
            "axis": vec3_property("Axis direction."),
            "center_m": vec3_property("Optional anchor point."),
            "name": { "type": "string" }
        },
        "required": ["base_radius_m", "top_radius_m", "height_m"],
        "additionalProperties": false
    })
}
fn schema_create_torus() -> Value {
    json!({
        "type": "object",
        "properties": {
            "major_radius_m": { "type": "number" },
            "minor_radius_m": { "type": "number" },
            "axis": vec3_property("Torus axis."),
            "center_m": vec3_property("Optional centre."),
            "name": { "type": "string" }
        },
        "required": ["major_radius_m", "minor_radius_m"],
        "additionalProperties": false
    })
}

fn schema_extrude() -> Value {
    json!({
        "type": "object",
        "properties": {
            "profile_points": polygon_property("Closed polygon profile in 3D."),
            "direction_m": vec3_property("Extrude direction times length, e.g. [0,0,0.05] for 50 mm in +Z."),
            "name": { "type": "string" }
        },
        "required": ["profile_points", "direction_m"],
        "additionalProperties": false
    })
}
fn schema_extrude_circle() -> Value {
    json!({
        "type": "object",
        "properties": {
            "radius_m": { "type": "number" },
            "center_m": vec3_property("Centre of the circle."),
            "axis": vec3_property("Axis normal of the circle plane."),
            "direction_m": vec3_property("Extrude vector."),
            "name": { "type": "string" }
        },
        "required": ["radius_m", "center_m", "axis", "direction_m"],
        "additionalProperties": false
    })
}
fn schema_revolve() -> Value {
    json!({
        "type": "object",
        "properties": {
            "profile_points": polygon_property("Profile polygon."),
            "axis_origin_m": vec3_property("Point on the rotation axis."),
            "axis_direction": vec3_property("Direction of the rotation axis."),
            "angle_deg": { "type": "number", "description": "Sweep angle, defaults to 360." },
            "name": { "type": "string" }
        },
        "required": ["profile_points", "axis_origin_m", "axis_direction"],
        "additionalProperties": false
    })
}
fn schema_loft() -> Value {
    json!({
        "type": "object",
        "properties": {
            "sections": {
                "type": "array",
                "items": polygon_property("One closed polygon section."),
                "minItems": 2,
            },
            "name": { "type": "string" }
        },
        "required": ["sections"],
        "additionalProperties": false
    })
}
fn schema_sweep() -> Value {
    json!({
        "type": "object",
        "properties": {
            "profile_points": polygon_property("Closed polygon profile."),
            "spine_points": polygon_property("Polyline spine."),
            "up_axis": vec3_property("Optional up axis to keep the profile aligned."),
            "name": { "type": "string" }
        },
        "required": ["profile_points", "spine_points"],
        "additionalProperties": false
    })
}

fn schema_boolean(target_desc: &'static str, tools_desc: &'static str) -> impl Fn() -> Value {
    move || {
        json!({
            "type": "object",
            "properties": {
                "target_id": handle_property(target_desc),
                "tool_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": tools_desc
                }
            },
            "required": ["target_id", "tool_ids"],
            "additionalProperties": false
        })
    }
}
fn schema_union() -> Value {
    schema_boolean(
        "Object id of the base body.",
        "Object ids of bodies that will be unioned into the base.",
    )()
}
fn schema_subtract() -> Value {
    schema_boolean(
        "Object id of the body to keep.",
        "Object ids of bodies that will be subtracted from the target.",
    )()
}
fn schema_intersect() -> Value {
    schema_boolean(
        "Object id of the base body.",
        "Object ids of bodies whose volume must overlap the target.",
    )()
}

fn schema_fillet() -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_id": handle_property("Object id of the solid to fillet."),
            "radius_m": { "type": "number" },
            "scope": {
                "type": "string",
                "enum": ["all_edges"],
                "description": "What to fillet. Only 'all_edges' is supported in V1."
            }
        },
        "required": ["target_id", "radius_m"],
        "additionalProperties": false
    })
}
fn schema_chamfer() -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_id": handle_property("Object id of the solid to chamfer."),
            "distance_m": { "type": "number" },
            "scope": {
                "type": "string",
                "enum": ["all_edges"],
                "description": "What to chamfer. Only 'all_edges' is supported in V1."
            }
        },
        "required": ["target_id", "distance_m"],
        "additionalProperties": false
    })
}
fn schema_shell() -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_id": handle_property("Object id of the solid to shell."),
            "thickness_m": { "type": "number", "description": "Wall thickness; negative offsets inward." },
            "open_all_faces": { "type": "boolean", "description": "If true, opens every face. Defaults to false (sealed cavity)." }
        },
        "required": ["target_id", "thickness_m"],
        "additionalProperties": false
    })
}

fn schema_translate() -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_id": handle_property("Object id of the solid to translate."),
            "delta_m": vec3_property("Translation vector in metres.")
        },
        "required": ["target_id", "delta_m"],
        "additionalProperties": false
    })
}
fn schema_rotate() -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_id": handle_property("Object id of the solid to rotate."),
            "axis": vec3_property("Rotation axis (only cardinal axes are supported in V1)."),
            "angle_deg": { "type": "number" }
        },
        "required": ["target_id", "axis", "angle_deg"],
        "additionalProperties": false
    })
}
fn schema_scale() -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_id": handle_property("Object id."),
            "pivot_m": vec3_property("Pivot point. Defaults to origin."),
            "factor": { "type": "number" }
        },
        "required": ["target_id", "factor"],
        "additionalProperties": false
    })
}
fn schema_mirror() -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_id": handle_property("Object id."),
            "plane_origin_m": vec3_property("Point on the mirror plane."),
            "plane_normal": vec3_property("Mirror plane normal.")
        },
        "required": ["target_id", "plane_normal"],
        "additionalProperties": false
    })
}
fn schema_copy() -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_id": handle_property("Object id of the source body."),
            "delta_m": vec3_property("Optional translation applied to the copy.")
        },
        "required": ["target_id"],
        "additionalProperties": false
    })
}

fn schema_inspect() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": handle_property("Optional object id; omit to summarise the whole project.")
        },
        "additionalProperties": false
    })
}
fn schema_list_objects() -> Value {
    empty_object()
}
fn schema_delete_object() -> Value {
    json!({
        "type": "object",
        "properties": { "id": handle_property("Object id to delete.") },
        "required": ["id"],
        "additionalProperties": false
    })
}
fn schema_rename_object() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": handle_property("Object id."),
            "name": { "type": "string" }
        },
        "required": ["id", "name"],
        "additionalProperties": false
    })
}

fn schema_export_step() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Absolute file path. If omitted the app picks a default in the user's data dir." }
        },
        "additionalProperties": false
    })
}
fn schema_export_stl() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": { "type": "string" },
            "deflection_m": { "type": "number", "description": "Mesh deflection in metres. Defaults to 0.0005." }
        },
        "additionalProperties": false
    })
}

fn schema_create_wing() -> Value {
    json!({
        "type": "object",
        "properties": {
            "span_m": { "type": "number" },
            "root_chord_m": { "type": "number" },
            "tip_chord_m": { "type": "number" },
            "sweep_deg": { "type": "number" },
            "dihedral_deg": { "type": "number" },
            "twist_deg": { "type": "number" },
            "airfoil": { "type": "string" },
            "symmetry": { "type": "boolean" },
            "name": { "type": "string" }
        },
        "required": ["span_m", "root_chord_m", "airfoil"],
        "additionalProperties": false
    })
}
fn schema_update_wing() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": handle_property("Wing id (defaults to the most recent)."),
            "name": { "type": "string" },
            "span_m": { "type": "number" },
            "root_chord_m": { "type": "number" },
            "tip_chord_m": { "type": "number" },
            "sweep_deg": { "type": "number" },
            "dihedral_deg": { "type": "number" },
            "twist_deg": { "type": "number" },
            "symmetry": { "type": "boolean" }
        },
        "additionalProperties": false
    })
}
fn schema_set_airfoil() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": handle_property("Wing id."),
            "airfoil": { "type": "string" }
        },
        "required": ["airfoil"],
        "additionalProperties": false
    })
}

fn schema_reference_geometry() -> Value {
    json!({
        "type": "object",
        "properties": {
            "reference_kind": { "type": "string", "enum": ["plane", "point", "line", "face", "surface"] },
            "name": { "type": "string" },
            "origin": vec3_property("Origin / centre of the reference."),
            "normal": vec3_property("Normal direction (planes/faces/surfaces)."),
            "end": vec3_property("Endpoint (lines)."),
            "size_m": { "type": "number", "description": "Visual size in metres." }
        },
        "required": ["reference_kind"],
        "additionalProperties": false
    })
}

// Stub schemas (default to empty object; the AI receives parameters informally
// in the description and we record the call in the timeline).
fn schema_stub_named() -> Value {
    json!({
        "type": "object",
        "properties": { "name": { "type": "string" } },
        "additionalProperties": true
    })
}

// =============================================================================
// Tool registry. Implemented entries dispatch via `dispatch::run_tool` in
// main.rs; stub entries respond with a "not yet implemented" timeline note.
// =============================================================================

pub fn catalog() -> Vec<ToolDescriptor> {
    use Implementation::*;
    use ToolCategory::*;

    vec![
        // ---- Solid primitives ----
        td(
            "create_box",
            SolidModelling,
            Implemented,
            "Create a rectangular solid box.",
            schema_create_box,
        ),
        td(
            "create_cylinder",
            SolidModelling,
            Implemented,
            "Create a cylinder along an axis.",
            schema_create_cylinder,
        ),
        td(
            "create_sphere",
            SolidModelling,
            Implemented,
            "Create a sphere.",
            schema_create_sphere,
        ),
        td(
            "create_cone",
            SolidModelling,
            Implemented,
            "Create a cone or frustum (set top_radius_m to 0 for a point).",
            schema_create_cone,
        ),
        td(
            "create_torus",
            SolidModelling,
            Implemented,
            "Create a torus / ring.",
            schema_create_torus,
        ),
        // ---- Solid features ----
        td(
            "extrude_polygon",
            SolidModelling,
            Implemented,
            "Extrude a closed polygon profile to make a solid.",
            schema_extrude,
        ),
        td(
            "extrude_circle",
            SolidModelling,
            Implemented,
            "Extrude a circle profile to make a cylindrical solid.",
            schema_extrude_circle,
        ),
        td(
            "revolve_polygon",
            SolidModelling,
            Stub,
            "Revolve a 2D profile around an axis.",
            schema_revolve,
        ),
        td(
            "loft_polygons",
            SolidModelling,
            Implemented,
            "Loft a solid through a sequence of polygon cross-sections.",
            schema_loft,
        ),
        td(
            "sweep_polygon",
            SolidModelling,
            Implemented,
            "Sweep a profile along a polyline spine.",
            schema_sweep,
        ),
        td(
            "boolean_union",
            SolidModelling,
            Implemented,
            "Union two or more solids.",
            schema_union,
        ),
        td(
            "boolean_subtract",
            SolidModelling,
            Implemented,
            "Subtract tools from a target solid.",
            schema_subtract,
        ),
        td(
            "boolean_intersect",
            SolidModelling,
            Implemented,
            "Keep only the volume shared by all listed solids.",
            schema_intersect,
        ),
        td(
            "fillet_edges",
            SolidModelling,
            Implemented,
            "Fillet edges with a uniform radius.",
            schema_fillet,
        ),
        td(
            "chamfer_edges",
            SolidModelling,
            Implemented,
            "Chamfer edges with a uniform distance.",
            schema_chamfer,
        ),
        td(
            "shell_solid",
            SolidModelling,
            Implemented,
            "Shell a solid: hollow it with a wall thickness.",
            schema_shell,
        ),
        td(
            "draft_face",
            SolidModelling,
            Stub,
            "Apply a draft angle to one or more faces.",
            schema_stub_named,
        ),
        td(
            "linear_pattern",
            SolidModelling,
            Stub,
            "Linear pattern of bodies/features.",
            schema_stub_named,
        ),
        td(
            "circular_pattern",
            SolidModelling,
            Stub,
            "Circular pattern of bodies/features.",
            schema_stub_named,
        ),
        td(
            "thicken_surface",
            SolidModelling,
            Stub,
            "Thicken a surface into a solid.",
            schema_stub_named,
        ),
        td(
            "replace_face",
            SolidModelling,
            Stub,
            "Replace one face of a solid with another surface.",
            schema_stub_named,
        ),
        td(
            "intersect_curve_solid",
            SolidModelling,
            Stub,
            "Intersect a curve with a solid to split edges.",
            schema_stub_named,
        ),
        // ---- Transforms ----
        td(
            "translate_solid",
            Transform,
            Implemented,
            "Translate a solid.",
            schema_translate,
        ),
        td(
            "rotate_solid",
            Transform,
            Implemented,
            "Rotate a solid (V1: cardinal axes only).",
            schema_rotate,
        ),
        td(
            "scale_solid",
            Transform,
            Implemented,
            "Uniform scale of a solid.",
            schema_scale,
        ),
        td(
            "mirror_solid",
            Transform,
            Implemented,
            "Mirror a solid across a plane.",
            schema_mirror,
        ),
        td(
            "copy_solid",
            Transform,
            Implemented,
            "Duplicate a solid (optionally translated).",
            schema_copy,
        ),
        // ---- Sketching (mostly stubs in V1) ----
        td(
            "create_sketch_plane",
            Sketching,
            Stub,
            "Start a 2D sketch on a plane, face, or origin.",
            schema_stub_named,
        ),
        td(
            "sketch_line",
            Sketching,
            Stub,
            "Draw a 2D line in the active sketch.",
            schema_stub_named,
        ),
        td(
            "sketch_arc",
            Sketching,
            Stub,
            "Draw a 2D arc.",
            schema_stub_named,
        ),
        td(
            "sketch_circle",
            Sketching,
            Stub,
            "Draw a 2D circle.",
            schema_stub_named,
        ),
        td(
            "sketch_rectangle",
            Sketching,
            Stub,
            "Draw a 2D rectangle.",
            schema_stub_named,
        ),
        td(
            "sketch_polygon",
            Sketching,
            Stub,
            "Draw an inscribed regular polygon.",
            schema_stub_named,
        ),
        td(
            "sketch_ellipse",
            Sketching,
            Stub,
            "Draw an ellipse.",
            schema_stub_named,
        ),
        td(
            "sketch_spline",
            Sketching,
            Stub,
            "Draw a B-spline through control points.",
            schema_stub_named,
        ),
        td(
            "sketch_offset",
            Sketching,
            Stub,
            "Offset a sketch entity.",
            schema_stub_named,
        ),
        td(
            "sketch_trim",
            Sketching,
            Stub,
            "Trim sketch entities.",
            schema_stub_named,
        ),
        td(
            "sketch_extend",
            Sketching,
            Stub,
            "Extend sketch entities.",
            schema_stub_named,
        ),
        td(
            "sketch_fillet_2d",
            Sketching,
            Stub,
            "2D fillet between sketch entities.",
            schema_stub_named,
        ),
        td(
            "sketch_chamfer_2d",
            Sketching,
            Stub,
            "2D chamfer between sketch entities.",
            schema_stub_named,
        ),
        td(
            "sketch_mirror_2d",
            Sketching,
            Stub,
            "Mirror sketch entities.",
            schema_stub_named,
        ),
        td(
            "sketch_pattern_linear",
            Sketching,
            Stub,
            "Linear pattern in a sketch.",
            schema_stub_named,
        ),
        td(
            "sketch_pattern_circular",
            Sketching,
            Stub,
            "Circular pattern in a sketch.",
            schema_stub_named,
        ),
        td(
            "sketch_dimension_distance",
            Sketching,
            Stub,
            "Add a dimension between two entities.",
            schema_stub_named,
        ),
        td(
            "sketch_dimension_radius",
            Sketching,
            Stub,
            "Dimension a circle/arc radius.",
            schema_stub_named,
        ),
        td(
            "sketch_dimension_angle",
            Sketching,
            Stub,
            "Dimension an angle.",
            schema_stub_named,
        ),
        td(
            "sketch_constraint_coincident",
            Sketching,
            Stub,
            "Constrain two points coincident.",
            schema_stub_named,
        ),
        td(
            "sketch_constraint_parallel",
            Sketching,
            Stub,
            "Constrain two lines parallel.",
            schema_stub_named,
        ),
        td(
            "sketch_constraint_perpendicular",
            Sketching,
            Stub,
            "Constrain two lines perpendicular.",
            schema_stub_named,
        ),
        td(
            "sketch_constraint_tangent",
            Sketching,
            Stub,
            "Constrain a curve tangent to another curve.",
            schema_stub_named,
        ),
        td(
            "sketch_finish",
            Sketching,
            Stub,
            "Close and validate the active sketch.",
            schema_stub_named,
        ),
        // ---- Surface modelling (stubs) ----
        td(
            "extrude_surface",
            SurfaceModelling,
            Stub,
            "Extrude a curve into a surface.",
            schema_stub_named,
        ),
        td(
            "revolve_surface",
            SurfaceModelling,
            Stub,
            "Revolve a curve into a surface.",
            schema_stub_named,
        ),
        td(
            "sweep_surface",
            SurfaceModelling,
            Stub,
            "Sweep a curve to make a surface.",
            schema_stub_named,
        ),
        td(
            "loft_surface",
            SurfaceModelling,
            Stub,
            "Loft a surface through curves.",
            schema_stub_named,
        ),
        td(
            "boundary_surface",
            SurfaceModelling,
            Stub,
            "Create a surface from a boundary set of curves.",
            schema_stub_named,
        ),
        td(
            "fill_surface",
            SurfaceModelling,
            Stub,
            "Fill a closed boundary with a surface.",
            schema_stub_named,
        ),
        td(
            "ruled_surface",
            SurfaceModelling,
            Stub,
            "Ruled surface between two curves.",
            schema_stub_named,
        ),
        td(
            "offset_surface",
            SurfaceModelling,
            Stub,
            "Offset a surface.",
            schema_stub_named,
        ),
        td(
            "trim_surface",
            SurfaceModelling,
            Stub,
            "Trim a surface against another.",
            schema_stub_named,
        ),
        td(
            "untrim_surface",
            SurfaceModelling,
            Stub,
            "Remove trim boundaries.",
            schema_stub_named,
        ),
        td(
            "knit_surfaces",
            SurfaceModelling,
            Stub,
            "Knit surfaces into a shell.",
            schema_stub_named,
        ),
        td(
            "split_surface",
            SurfaceModelling,
            Stub,
            "Split a surface with a curve.",
            schema_stub_named,
        ),
        td(
            "patch_surface",
            SurfaceModelling,
            Stub,
            "Patch a hole in a surface.",
            schema_stub_named,
        ),
        td(
            "planar_surface",
            SurfaceModelling,
            Stub,
            "Create a planar surface.",
            schema_stub_named,
        ),
        // ---- Sheet metal (stubs) ----
        td(
            "sheet_metal_base_flange",
            SheetMetal,
            Stub,
            "Base flange from a sketch.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_edge_flange",
            SheetMetal,
            Stub,
            "Edge flange off a sheet edge.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_miter_flange",
            SheetMetal,
            Stub,
            "Miter flange.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_hem",
            SheetMetal,
            Stub,
            "Hem an edge.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_contour_flange",
            SheetMetal,
            Stub,
            "Contour flange from a profile.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_jog",
            SheetMetal,
            Stub,
            "Jog along a sketch line.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_fold",
            SheetMetal,
            Stub,
            "Fold along a line.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_unfold",
            SheetMetal,
            Stub,
            "Unfold one bend.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_flatten",
            SheetMetal,
            Stub,
            "Flatten the entire part.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_corner_relief",
            SheetMetal,
            Stub,
            "Add corner relief cuts.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_bend",
            SheetMetal,
            Stub,
            "Bend a flat region.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_unbend",
            SheetMetal,
            Stub,
            "Unbend a region.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_cut",
            SheetMetal,
            Stub,
            "Cut a sheet metal body normal-to-face.",
            schema_stub_named,
        ),
        td(
            "sheet_metal_corner_trim",
            SheetMetal,
            Stub,
            "Trim sheet corners.",
            schema_stub_named,
        ),
        // ---- Reference / measure ----
        td(
            "create_reference_geometry",
            Reference,
            Implemented,
            "Create reference geometry (plane / point / line / face / surface).",
            schema_reference_geometry,
        ),
        td(
            "measure_distance",
            Inspection,
            Stub,
            "Measure distance between two points or entities.",
            schema_stub_named,
        ),
        td(
            "measure_angle",
            Inspection,
            Stub,
            "Measure angle between two entities.",
            schema_stub_named,
        ),
        td(
            "measure_volume",
            Inspection,
            Stub,
            "Measure volume of a solid.",
            schema_stub_named,
        ),
        td(
            "measure_surface_area",
            Inspection,
            Stub,
            "Measure surface area.",
            schema_stub_named,
        ),
        // ---- Inspection / project ----
        td(
            "inspect_geometry",
            Inspection,
            Implemented,
            "Summarise one object or the whole project.",
            schema_inspect,
        ),
        td(
            "list_objects",
            Inspection,
            Implemented,
            "List every object in the project tree.",
            schema_list_objects,
        ),
        td(
            "delete_object",
            Inspection,
            Implemented,
            "Delete an object by id.",
            schema_delete_object,
        ),
        td(
            "rename_object",
            Inspection,
            Implemented,
            "Rename an object.",
            schema_rename_object,
        ),
        // ---- File I/O ----
        td(
            "export_step",
            FileIo,
            Implemented,
            "Export the current project's solids to STEP via cadrum.",
            schema_export_step,
        ),
        td(
            "export_stl",
            FileIo,
            Implemented,
            "Export the current project to STL via cadrum mesher.",
            schema_export_stl,
        ),
        // ---- Aircraft-specific (legacy V1, still useful) ----
        td(
            "create_wing",
            SolidModelling,
            Implemented,
            "Create a parametric NACA wing using the legacy aircraft model.",
            schema_create_wing,
        ),
        td(
            "update_wing_parameters",
            SolidModelling,
            Implemented,
            "Update parameters on an existing wing.",
            schema_update_wing,
        ),
        td(
            "set_airfoil",
            SolidModelling,
            Implemented,
            "Set the airfoil designation for a wing.",
            schema_set_airfoil,
        ),
    ]
}

fn td(
    name: &'static str,
    category: ToolCategory,
    implementation: Implementation,
    description: &'static str,
    parameters: fn() -> Value,
) -> ToolDescriptor {
    ToolDescriptor {
        name,
        category,
        implementation,
        description,
        parameters,
    }
}

pub fn openai_tool_array() -> Vec<Value> {
    catalog().iter().map(|d| d.to_openai_schema()).collect()
}

pub fn lookup(name: &str) -> Option<ToolDescriptor> {
    catalog().into_iter().find(|d| d.name == name)
}
