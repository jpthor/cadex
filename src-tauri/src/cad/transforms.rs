use cadrum::DVec3;

use super::state::{KernelHandle, KernelState};
use super::types::{KernelError, Vec3};

fn vec(v: Vec3) -> DVec3 {
    DVec3::new(v[0], v[1], v[2])
}

pub fn translate(
    state: &KernelState,
    handle: &KernelHandle,
    delta: Vec3,
) -> Result<(), KernelError> {
    let solid = state.clone_solid(handle)?;
    state.replace(handle, solid.translate(vec(delta)))
}

pub fn rotate(
    state: &KernelState,
    handle: &KernelHandle,
    axis: Vec3,
    angle_rad: f64,
) -> Result<(), KernelError> {
    let solid = state.clone_solid(handle)?;
    let a = vec(axis);
    if a.length_squared() < 1e-12 {
        return Err(KernelError::InvalidArgument(
            "rotation axis must be non-zero".into(),
        ));
    }
    // cadrum exposes rotate_x / rotate_y / rotate_z helpers; for arbitrary
    // axes we approximate by composing rotations only when axis aligns with a
    // cardinal direction. Anything else is rejected for now (until we expose
    // cadrum's full DQuat-based transform).
    let n = a.normalize();
    let rotated = if (n - DVec3::X).length() < 1e-9 {
        solid.rotate_x(angle_rad)
    } else if (n - DVec3::NEG_X).length() < 1e-9 {
        solid.rotate_x(-angle_rad)
    } else if (n - DVec3::Y).length() < 1e-9 {
        solid.rotate_y(angle_rad)
    } else if (n - DVec3::NEG_Y).length() < 1e-9 {
        solid.rotate_y(-angle_rad)
    } else if (n - DVec3::Z).length() < 1e-9 {
        solid.rotate_z(angle_rad)
    } else if (n - DVec3::NEG_Z).length() < 1e-9 {
        solid.rotate_z(-angle_rad)
    } else {
        return Err(KernelError::NotImplemented(
            "rotation about non-cardinal axes is not yet wired up".into(),
        ));
    };
    state.replace(handle, rotated)
}

pub fn scale(
    state: &KernelState,
    handle: &KernelHandle,
    pivot: Vec3,
    factor: f64,
) -> Result<(), KernelError> {
    if factor == 0.0 {
        return Err(KernelError::InvalidArgument(
            "scale factor must be non-zero".into(),
        ));
    }
    let solid = state.clone_solid(handle)?;
    state.replace(handle, solid.scale(vec(pivot), factor))
}

pub fn mirror(
    state: &KernelState,
    handle: &KernelHandle,
    plane_point: Vec3,
    plane_normal: Vec3,
) -> Result<(), KernelError> {
    let n = vec(plane_normal);
    if n.length_squared() < 1e-12 {
        return Err(KernelError::InvalidArgument(
            "mirror plane normal must be non-zero".into(),
        ));
    }
    let solid = state.clone_solid(handle)?;
    state.replace(handle, solid.mirror(vec(plane_point), n.normalize()))
}
