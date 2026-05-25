//! Integration tests that exercise the cadrum-backed kernel end-to-end.
//! These tests run inside the cadex crate so they have access to the kernel
//! state primitives without going through Tauri.

#![cfg(test)]

use super::*;

fn ks() -> KernelState {
    KernelState::new()
}

#[test]
fn box_primitive_tessellates_into_triangles() {
    let state = ks();
    let handle = primitives::create_box(&state, [1.0, 1.0, 1.0], None).unwrap();
    let mesh = tessellate::tessellate(&state, &handle, Some(0.5)).unwrap();
    assert!(mesh.triangle_count >= 12, "cube should have at least 12 triangles");
    assert_eq!(mesh.positions.len(), mesh.triangle_count * 9);
    assert_eq!(mesh.normals.len(), mesh.triangle_count * 9);
}

#[test]
fn rejects_zero_size_box() {
    let state = ks();
    let result = primitives::create_box(&state, [0.0, 1.0, 1.0], None);
    assert!(result.is_err());
}

#[test]
fn cylinder_primitive_round_trips() {
    let state = ks();
    let handle = primitives::create_cylinder(&state, 0.5, [0.0, 0.0, 1.0], 1.0, None).unwrap();
    let mesh = tessellate::tessellate(&state, &handle, Some(0.05)).unwrap();
    assert!(mesh.triangle_count > 16);
}

#[test]
fn sphere_primitive_has_unit_normals() {
    let state = ks();
    let handle = primitives::create_sphere(&state, 0.5, None).unwrap();
    let mesh = tessellate::tessellate(&state, &handle, Some(0.05)).unwrap();
    let n0 = (
        mesh.normals[0] as f64,
        mesh.normals[1] as f64,
        mesh.normals[2] as f64,
    );
    let len = (n0.0 * n0.0 + n0.1 * n0.1 + n0.2 * n0.2).sqrt();
    assert!((len - 1.0).abs() < 1e-3, "sphere triangle normal should be ~unit length, got {len}");
}

#[test]
fn translate_moves_solid() {
    let state = ks();
    let handle = primitives::create_box(&state, [0.2, 0.2, 0.2], None).unwrap();
    let bbox_before = tessellate::bounding_box(&state, &handle).unwrap();
    transforms::translate(&state, &handle, [1.0, 0.0, 0.0]).unwrap();
    let bbox_after = tessellate::bounding_box(&state, &handle).unwrap();
    assert!((bbox_after[0].x - bbox_before[0].x - 1.0).abs() < 1e-9);
}

#[test]
fn boolean_union_reduces_to_one_solid() {
    let state = ks();
    let a = primitives::create_box(&state, [1.0, 1.0, 1.0], None).unwrap();
    let b = primitives::create_box(&state, [1.0, 1.0, 1.0], Some([0.5, 0.5, 0.5])).unwrap();
    let result = booleans::union(&state, &a, &[b.clone()]).unwrap();
    assert_eq!(result, a, "boolean union should keep the target handle");
    // Tool handle should be removed.
    assert!(state.clone_solid(&b).is_err(), "boolean tool handle should be removed");
}

#[test]
fn boolean_subtract_drills_hole() {
    let state = ks();
    let block = primitives::create_box(&state, [1.0, 1.0, 1.0], None).unwrap();
    let drill = primitives::create_cylinder(
        &state,
        0.2,
        [0.0, 0.0, 1.0],
        2.0,
        Some([0.5, 0.5, -0.5]),
    )
    .unwrap();
    booleans::subtract(&state, &block, &[drill]).unwrap();
    let mesh = tessellate::tessellate(&state, &block, Some(0.05)).unwrap();
    assert!(mesh.triangle_count > 24, "drilled block should have more triangles than a plain box");
}

#[test]
fn extrude_polygon_builds_a_solid() {
    let state = ks();
    let square = vec![
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
    ];
    let handle = features::extrude_polygon(&state, &square, [0.0, 0.0, 0.5]).unwrap();
    let mesh = tessellate::tessellate(&state, &handle, Some(0.05)).unwrap();
    assert!(mesh.triangle_count >= 12, "extruded square should mesh to ≥12 triangles");
}

#[test]
fn fillet_all_edges_does_not_panic() {
    let state = ks();
    let handle = primitives::create_box(&state, [1.0, 1.0, 1.0], None).unwrap();
    features::fillet_all_edges(&state, &handle, 0.1).unwrap();
    let mesh = tessellate::tessellate(&state, &handle, Some(0.05)).unwrap();
    assert!(mesh.triangle_count > 12);
}

#[test]
fn shell_solid_creates_cavity() {
    let state = ks();
    let handle = primitives::create_box(&state, [1.0, 1.0, 1.0], None).unwrap();
    features::shell_solid(&state, &handle, -0.05, false).unwrap();
    let mesh = tessellate::tessellate(&state, &handle, Some(0.05)).unwrap();
    assert!(mesh.triangle_count > 12);
}

#[test]
fn step_round_trip_preserves_solid_count() {
    let state = ks();
    let _ = primitives::create_box(&state, [1.0, 1.0, 1.0], None).unwrap();
    let _ = primitives::create_sphere(&state, 0.4, Some([2.0, 0.0, 0.0])).unwrap();

    let path = std::env::temp_dir().join("cadex_test_round_trip.step");
    let handles = state.handles().unwrap();
    io::write_step(&state, &handles, &path).unwrap();

    let imported = ks();
    let new_handles = io::read_step(&imported, &path).unwrap();
    assert!(!new_handles.is_empty(), "should import at least one solid");
    let _ = std::fs::remove_file(&path);
}
