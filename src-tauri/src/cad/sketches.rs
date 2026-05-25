use cadrum::{DVec3, Edge};

use super::types::{KernelError, Vec3};

/// A sketch profile reduced to a closed polyline in 3D. Used as input to
/// extrude/sweep/loft. The polyline is automatically closed (first vertex
/// repeated implicitly) and must contain at least three distinct vertices.
#[derive(Debug, Clone)]
pub struct PolygonProfile {
    pub points: Vec<DVec3>,
}

impl PolygonProfile {
    pub fn from_points(points: &[Vec3]) -> Result<Self, KernelError> {
        if points.len() < 3 {
            return Err(KernelError::InvalidArgument(
                "polygon profile needs at least 3 points".into(),
            ));
        }
        let pts: Vec<DVec3> = points
            .iter()
            .map(|p| DVec3::new(p[0], p[1], p[2]))
            .collect();
        Ok(Self { points: pts })
    }

    pub fn to_edge(&self) -> Result<Vec<Edge>, KernelError> {
        Ok(Edge::polygon(&self.points)?)
    }
}

/// A planar circle profile: centre + axis (normal) + radius.
pub fn circle_profile(
    radius: f64,
    axis: Vec3,
    centre: Vec3,
) -> Result<Vec<Edge>, KernelError> {
    if radius <= 0.0 {
        return Err(KernelError::InvalidArgument(
            "circle radius must be positive".into(),
        ));
    }
    let axis_v = DVec3::new(axis[0], axis[1], axis[2]);
    if axis_v.length_squared() < 1e-12 {
        return Err(KernelError::InvalidArgument(
            "circle axis must be non-zero".into(),
        ));
    }
    let edge = Edge::circle(radius, axis_v.normalize())?
        .translate(DVec3::new(centre[0], centre[1], centre[2]));
    Ok(vec![edge])
}
