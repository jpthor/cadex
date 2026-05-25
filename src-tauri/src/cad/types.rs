use serde::{Deserialize, Serialize};
use thiserror::Error;

/// 3D vector used at the Tauri boundary. Stored as `[f64; 3]` so JSON
/// serialisation matches the JS `[x, y, z]` tuples used throughout the
/// frontend.
pub type Vec3 = [f64; 3];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshPayload {
    pub triangle_count: usize,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
}

#[derive(Debug, Error)]
pub enum KernelError {
    #[error("kernel handle '{0}' not found")]
    UnknownHandle(String),
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("cadrum error: {0}")]
    Cadrum(String),
    #[error("not implemented: {0}")]
    NotImplemented(String),
    #[error("kernel mutex poisoned")]
    Poisoned,
}

impl From<cadrum::Error> for KernelError {
    fn from(error: cadrum::Error) -> Self {
        KernelError::Cadrum(format!("{error:?}"))
    }
}
