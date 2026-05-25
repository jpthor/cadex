use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CadProject {
    pub id: String,
    pub name: String,
    pub units: String,
    pub objects: Vec<CadObject>,
    pub timeline: Vec<TimelineEvent>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CadObject {
    Wing(Wing),
    Mesh(MeshObject),
    Solid(SolidObject),
    Reference(ReferenceGeometry),
}

impl CadObject {
    pub fn id(&self) -> &str {
        match self {
            CadObject::Wing(w) => &w.id,
            CadObject::Mesh(m) => &m.id,
            CadObject::Solid(s) => &s.id,
            CadObject::Reference(r) => &r.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            CadObject::Wing(w) => &w.name,
            CadObject::Mesh(m) => &m.name,
            CadObject::Solid(s) => &s.name,
            CadObject::Reference(r) => &r.name,
        }
    }

    pub fn set_name(&mut self, name: String) {
        match self {
            CadObject::Wing(w) => w.name = name,
            CadObject::Mesh(m) => m.name = name,
            CadObject::Solid(s) => s.name = name,
            CadObject::Reference(r) => r.name = name,
        }
    }

    pub fn kernel_handle(&self) -> Option<&str> {
        match self {
            CadObject::Solid(s) => Some(&s.kernel_handle),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Wing {
    pub id: String,
    pub name: String,
    pub span_m: f64,
    pub root_chord_m: f64,
    pub tip_chord_m: f64,
    pub sweep_deg: f64,
    pub dihedral_deg: f64,
    pub twist_deg: f64,
    pub airfoil: String,
    pub symmetry: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeshObject {
    pub id: String,
    pub name: String,
    pub source: String,
    pub triangle_count: usize,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SolidObject {
    pub id: String,
    pub name: String,
    pub source: String,
    pub kernel_handle: String,
    pub triangle_count: usize,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceGeometry {
    pub id: String,
    pub name: String,
    pub reference_kind: String,
    pub origin: Vec<f64>,
    pub normal: Option<Vec<f64>>,
    pub end: Option<Vec<f64>>,
    pub size_m: Option<f64>,
    pub source_selection: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub id: String,
    pub label: String,
    pub detail: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignRequest {
    pub prompt: String,
    pub project: CadProject,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub project: CadProject,
    pub format: String,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub project: CadProject,
    pub path: String,
    pub format: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiRequest {
    pub api_key: String,
    pub model: String,
    pub message: String,
    pub project: CadProject,
    pub selected_geometry: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiResult {
    pub assistant_text: String,
    pub project: CadProject,
}
