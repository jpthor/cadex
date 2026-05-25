//! Cadex CAD kernel: a thin abstraction over the cadrum (OpenCASCADE) library
//! that owns all live `Solid`s in memory and exposes them to the rest of the
//! app through opaque string handles. Solids never cross the Tauri boundary;
//! callers receive a tessellated `MeshObject` to render and a kernel handle
//! to refer back to the BREP solid for further operations.

pub mod booleans;
pub mod features;
pub mod io;
pub mod primitives;
pub mod sketches;
pub mod state;
pub mod tessellate;
pub mod transforms;
pub mod types;

pub use state::KernelState;
#[allow(unused_imports)]
pub use state::KernelHandle;
#[allow(unused_imports)]
pub use types::{KernelError, MeshPayload, Vec3};
