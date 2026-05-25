use std::fs::File;
use std::path::Path;

use cadrum::Solid;

use super::state::{KernelHandle, KernelState};
use super::types::KernelError;

/// Write the listed solids to a STEP file.
pub fn write_step(
    state: &KernelState,
    handles: &[KernelHandle],
    path: &Path,
) -> Result<(), KernelError> {
    let solids: Vec<_> = handles
        .iter()
        .map(|h| state.clone_solid(h))
        .collect::<Result<_, _>>()?;
    let mut file = File::create(path)
        .map_err(|e| KernelError::Cadrum(format!("create STEP file: {e}")))?;
    Solid::write_step(&solids, &mut file)?;
    Ok(())
}

/// Read a STEP file and import every solid contained in it. Returns the new
/// handles in the order cadrum reported them.
pub fn read_step(state: &KernelState, path: &Path) -> Result<Vec<KernelHandle>, KernelError> {
    let mut file = File::open(path)
        .map_err(|e| KernelError::Cadrum(format!("open STEP file: {e}")))?;
    let solids = Solid::read_step(&mut file)?;
    let mut handles = Vec::with_capacity(solids.len());
    for solid in solids {
        handles.push(state.insert(solid)?);
    }
    Ok(handles)
}

/// Write all listed solids to an STL file via cadrum's mesh exporter.
pub fn write_stl(
    state: &KernelState,
    handles: &[KernelHandle],
    path: &Path,
    deflection: f64,
) -> Result<(), KernelError> {
    let solids: Vec<_> = handles
        .iter()
        .map(|h| state.clone_solid(h))
        .collect::<Result<_, _>>()?;
    let mesh = Solid::mesh(&solids, deflection.max(1e-6))?;
    let mut file = File::create(path)
        .map_err(|e| KernelError::Cadrum(format!("create STL file: {e}")))?;
    mesh.write_stl(&mut file)
        .map_err(|e| KernelError::Cadrum(format!("write STL: {e}")))?;
    Ok(())
}
