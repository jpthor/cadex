use std::io::{self, Write};

use cadrum::{DVec3, Solid};

use super::state::{KernelHandle, KernelState};
use super::types::{KernelError, MeshPayload};

/// Default deflection used when tessellating a solid for the live preview
/// canvas. Smaller = finer triangles. 0.5mm is a good default for objects
/// measured in metres in this app (where typical bounding boxes are 0.1–2 m).
const DEFAULT_DEFLECTION_M: f64 = 0.0005;

/// Tessellate the solid and return position + (vertex) normal arrays suitable
/// for rendering with three.js. Cadrum returns flat triangle data through
/// `Mesh::write_stl`; we reuse the binary STL writer because it carries
/// per-triangle normals, then expand to per-vertex storage to match the
/// frontend MeshObject schema.
pub fn tessellate(
    state: &KernelState,
    handle: &KernelHandle,
    deflection: Option<f64>,
) -> Result<MeshPayload, KernelError> {
    let solid = state.clone_solid(handle)?;
    let solids = vec![solid];
    let deflection = deflection.unwrap_or(DEFAULT_DEFLECTION_M).max(1e-6);
    let mesh = Solid::mesh(&solids, deflection)?;

    let mut buffer = Vec::new();
    mesh.write_stl(&mut Writer(&mut buffer))
        .map_err(|e| KernelError::Cadrum(format!("write_stl: {e}")))?;
    parse_binary_stl_payload(&buffer)
}

struct Writer<'a>(&'a mut Vec<u8>);

impl<'a> Write for Writer<'a> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn parse_binary_stl_payload(bytes: &[u8]) -> Result<MeshPayload, KernelError> {
    if bytes.len() < 84 {
        return Err(KernelError::Cadrum("binary STL too small".into()));
    }
    let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
    let expected = 84usize.saturating_add(count.saturating_mul(50));
    if expected != bytes.len() {
        return Err(KernelError::Cadrum(format!(
            "binary STL size mismatch: expected {expected} got {}",
            bytes.len()
        )));
    }

    let mut positions = Vec::with_capacity(count * 9);
    let mut normals = Vec::with_capacity(count * 9);
    let mut offset = 84usize;
    for _ in 0..count {
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

    Ok(MeshPayload {
        triangle_count: count,
        positions,
        normals,
    })
}

fn read_f32(slice: &[u8], at: usize) -> Result<f32, KernelError> {
    if at + 4 > slice.len() {
        return Err(KernelError::Cadrum("truncated binary STL".into()));
    }
    Ok(f32::from_le_bytes([
        slice[at],
        slice[at + 1],
        slice[at + 2],
        slice[at + 3],
    ]))
}

/// Approximate the solid's axis-aligned bounding box from its vertices.
/// Currently used by the AI inspect tool to describe a kernel solid.
pub fn bounding_box(state: &KernelState, handle: &KernelHandle) -> Result<[DVec3; 2], KernelError> {
    state.with(handle, |solid| solid.bounding_box())
}

/// Convenience helper used elsewhere when we want the solid centroid.
pub fn centroid(state: &KernelState, handle: &KernelHandle) -> Result<DVec3, KernelError> {
    let [min, max] = bounding_box(state, handle)?;
    Ok((min + max) * 0.5)
}

#[allow(dead_code)]
fn _unused(_: Solid) {}
