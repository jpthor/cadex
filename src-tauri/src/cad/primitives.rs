use cadrum::{DVec3, Solid};

use super::state::{KernelHandle, KernelState};
use super::types::{KernelError, Vec3};

fn vec(v: Vec3) -> DVec3 {
    DVec3::new(v[0], v[1], v[2])
}

pub fn create_box(
    state: &KernelState,
    size: Vec3,
    center: Option<Vec3>,
) -> Result<KernelHandle, KernelError> {
    if size.iter().any(|d| *d <= 0.0) {
        return Err(KernelError::InvalidArgument(
            "box size components must be positive".into(),
        ));
    }
    let mut solid = Solid::cube(size[0], size[1], size[2]);
    if let Some(c) = center {
        let half = DVec3::new(size[0], size[1], size[2]) * 0.5;
        solid = solid.translate(vec(c) - half);
    }
    state.insert(solid)
}

pub fn create_cylinder(
    state: &KernelState,
    radius: f64,
    axis: Vec3,
    height: f64,
    center: Option<Vec3>,
) -> Result<KernelHandle, KernelError> {
    if radius <= 0.0 || height <= 0.0 {
        return Err(KernelError::InvalidArgument(
            "cylinder radius and height must be positive".into(),
        ));
    }
    let axis_v = vec(axis);
    if axis_v.length_squared() < 1e-12 {
        return Err(KernelError::InvalidArgument(
            "cylinder axis must be non-zero".into(),
        ));
    }
    let mut solid = Solid::cylinder(radius, axis_v.normalize(), height);
    if let Some(c) = center {
        solid = solid.translate(vec(c));
    }
    state.insert(solid)
}

pub fn create_sphere(
    state: &KernelState,
    radius: f64,
    center: Option<Vec3>,
) -> Result<KernelHandle, KernelError> {
    if radius <= 0.0 {
        return Err(KernelError::InvalidArgument(
            "sphere radius must be positive".into(),
        ));
    }
    let mut solid = Solid::sphere(radius);
    if let Some(c) = center {
        solid = solid.translate(vec(c));
    }
    state.insert(solid)
}

pub fn create_cone(
    state: &KernelState,
    base_radius: f64,
    top_radius: f64,
    axis: Vec3,
    height: f64,
    center: Option<Vec3>,
) -> Result<KernelHandle, KernelError> {
    if base_radius < 0.0 || top_radius < 0.0 || (base_radius + top_radius) <= 0.0 {
        return Err(KernelError::InvalidArgument(
            "cone radii must be non-negative and not both zero".into(),
        ));
    }
    if height <= 0.0 {
        return Err(KernelError::InvalidArgument(
            "cone height must be positive".into(),
        ));
    }
    let axis_v = vec(axis);
    if axis_v.length_squared() < 1e-12 {
        return Err(KernelError::InvalidArgument(
            "cone axis must be non-zero".into(),
        ));
    }
    let mut solid = Solid::cone(base_radius, top_radius, axis_v.normalize(), height);
    if let Some(c) = center {
        solid = solid.translate(vec(c));
    }
    state.insert(solid)
}

pub fn create_torus(
    state: &KernelState,
    major_radius: f64,
    minor_radius: f64,
    axis: Vec3,
    center: Option<Vec3>,
) -> Result<KernelHandle, KernelError> {
    if major_radius <= 0.0 || minor_radius <= 0.0 {
        return Err(KernelError::InvalidArgument(
            "torus radii must be positive".into(),
        ));
    }
    if minor_radius >= major_radius {
        return Err(KernelError::InvalidArgument(
            "torus minor radius must be smaller than major radius".into(),
        ));
    }
    let axis_v = vec(axis);
    if axis_v.length_squared() < 1e-12 {
        return Err(KernelError::InvalidArgument(
            "torus axis must be non-zero".into(),
        ));
    }
    let mut solid = Solid::torus(major_radius, minor_radius, axis_v.normalize());
    if let Some(c) = center {
        solid = solid.translate(vec(c));
    }
    state.insert(solid)
}

#[allow(dead_code)]
pub fn create_half_space(
    state: &KernelState,
    point: Vec3,
    normal: Vec3,
) -> Result<KernelHandle, KernelError> {
    let n = vec(normal);
    if n.length_squared() < 1e-12 {
        return Err(KernelError::InvalidArgument(
            "half-space normal must be non-zero".into(),
        ));
    }
    Ok(state.insert(Solid::half_space(vec(point), n.normalize()))?)
}
