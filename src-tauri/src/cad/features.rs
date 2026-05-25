use cadrum::{DVec3, Edge, ProfileOrient, Solid};

use super::sketches::{circle_profile, PolygonProfile};
use super::state::{KernelHandle, KernelState};
use super::types::{KernelError, Vec3};

fn vec(v: Vec3) -> DVec3 {
    DVec3::new(v[0], v[1], v[2])
}

/// Extrude a closed polygon profile by `direction` to produce a solid.
pub fn extrude_polygon(
    state: &KernelState,
    profile_points: &[Vec3],
    direction: Vec3,
) -> Result<KernelHandle, KernelError> {
    let dir = vec(direction);
    if dir.length_squared() < 1e-12 {
        return Err(KernelError::InvalidArgument(
            "extrude direction must be non-zero".into(),
        ));
    }
    let profile = PolygonProfile::from_points(profile_points)?;
    let solid = Solid::extrude(&profile.to_edge()?, dir)?;
    state.insert(solid)
}

/// Extrude a circle profile (centre/axis/radius) by `direction`.
pub fn extrude_circle(
    state: &KernelState,
    radius: f64,
    centre: Vec3,
    axis: Vec3,
    direction: Vec3,
) -> Result<KernelHandle, KernelError> {
    let dir = vec(direction);
    if dir.length_squared() < 1e-12 {
        return Err(KernelError::InvalidArgument(
            "extrude direction must be non-zero".into(),
        ));
    }
    let profile = circle_profile(radius, axis, centre)?;
    let solid = Solid::extrude(&profile, dir)?;
    state.insert(solid)
}

/// Loft through a sequence of polygon profiles (each must have the same
/// vertex count for now).
pub fn loft_polygons(
    state: &KernelState,
    sections: &[Vec<Vec3>],
) -> Result<KernelHandle, KernelError> {
    if sections.len() < 2 {
        return Err(KernelError::InvalidArgument(
            "loft requires at least two sections".into(),
        ));
    }
    let mut wires: Vec<Vec<Edge>> = Vec::with_capacity(sections.len());
    for points in sections {
        wires.push(PolygonProfile::from_points(points)?.to_edge()?);
    }
    let slices: Vec<&[Edge]> = wires.iter().map(|w| w.as_slice()).collect();
    let solid = Solid::loft(slices)?;
    state.insert(solid)
}

/// Sweep a polygon profile along a polyline spine.
pub fn sweep_polygon(
    state: &KernelState,
    profile_points: &[Vec3],
    spine_points: &[Vec3],
    up_axis: Option<Vec3>,
) -> Result<KernelHandle, KernelError> {
    if spine_points.len() < 2 {
        return Err(KernelError::InvalidArgument(
            "sweep spine requires at least 2 points".into(),
        ));
    }
    let profile = PolygonProfile::from_points(profile_points)?.to_edge()?;
    let mut spine: Vec<Edge> = Vec::with_capacity(spine_points.len() - 1);
    for window in spine_points.windows(2) {
        spine.push(Edge::line(vec(window[0]), vec(window[1]))?);
    }
    let orient = match up_axis {
        Some(axis) => {
            let a = vec(axis);
            if a.length_squared() < 1e-12 {
                ProfileOrient::Torsion
            } else {
                ProfileOrient::Up(a.normalize())
            }
        }
        None => ProfileOrient::Torsion,
    };
    let solid = Solid::sweep(&profile, &spine, orient)?;
    state.insert(solid)
}

/// Create a thin shell from an existing solid by removing one or more faces
/// and offsetting inward by `thickness`.
///
/// We don't yet have a way to address individual faces from outside the
/// kernel; for now we shell with no opened faces (sealed) or all faces
/// (opened) when `open_all_faces` is true.
pub fn shell_solid(
    state: &KernelState,
    handle: &KernelHandle,
    thickness: f64,
    open_all_faces: bool,
) -> Result<KernelHandle, KernelError> {
    if thickness == 0.0 {
        return Err(KernelError::InvalidArgument(
            "shell thickness must be non-zero".into(),
        ));
    }
    let solid = state.clone_solid(handle)?;
    let new_solid = if open_all_faces {
        let faces: Vec<_> = solid.iter_face().collect();
        solid.shell(thickness, faces)?
    } else {
        solid.shell(thickness, std::iter::empty::<&cadrum::Face>())?
    };
    state.replace(handle, new_solid)?;
    Ok(handle.clone())
}

/// Apply a uniform fillet radius to all edges of the solid.
pub fn fillet_all_edges(
    state: &KernelState,
    handle: &KernelHandle,
    radius: f64,
) -> Result<KernelHandle, KernelError> {
    if radius <= 0.0 {
        return Err(KernelError::InvalidArgument(
            "fillet radius must be positive".into(),
        ));
    }
    let solid = state.clone_solid(handle)?;
    let edges: Vec<_> = solid.iter_edge().collect();
    let new_solid = solid.fillet_edges(radius, edges)?;
    state.replace(handle, new_solid)?;
    Ok(handle.clone())
}

/// Apply a uniform chamfer distance to all edges of the solid.
pub fn chamfer_all_edges(
    state: &KernelState,
    handle: &KernelHandle,
    distance: f64,
) -> Result<KernelHandle, KernelError> {
    if distance <= 0.0 {
        return Err(KernelError::InvalidArgument(
            "chamfer distance must be positive".into(),
        ));
    }
    let solid = state.clone_solid(handle)?;
    let edges: Vec<_> = solid.iter_edge().collect();
    let new_solid = solid.chamfer_edges(distance, edges)?;
    state.replace(handle, new_solid)?;
    Ok(handle.clone())
}
