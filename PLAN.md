# Cadex Generic Parametric CAD Plan

## Summary
Build a generic CAD-style parametric designer with a React/Three.js viewport, dependency browser, AI-assisted feature creation, and export paths. The app should create parts from planes, sketches, profiles, paths, and operations rather than hard-coded product templates.

## Core Model
- Origin references: world origin and standard planes.
- Construction features: planes, points, lines, profile sketches, path sketches, faces, and surfaces.
- Operations: loft, sweep, extrude, orient/place.
- Bodies: generic solids/meshes generated from the operation graph.
- Dependencies: every feature can declare `dependsOn`, so one operation can depend on multiple sibling sketches or paths.

## User Flow
- User opens the app.
- The central canvas shows grid, origin, axes, and editable CAD reference geometry.
- The user enters a natural-language CAD command.
- The AI selects a generic operation and profile/path inputs.
- The app creates a dependency tree such as `Origin -> Plane -> Sketch/Profile + Path -> Loft/Sweep/Extrude -> Body`.
- The browser panel can switch between flat Browser and dependency-tree views.
- The user reviews geometry and exports STL or STEP where available.

## OpenAI Tool Schema
- `create_part`: generic parametric body from `operation`, `profile_kind`, dimensions, optional profile code, sketch plane, and origin.
- `create_reference_geometry`: construction/reference geometry.
- `orient_part`: place an existing body on an origin plane or anchor.

## Test Plan
- Build/type-check frontend.
- Verify the browser view and Dependencies tab render.
- Verify generic prompts create visible bodies and dependency nodes.
- Verify selection works from both canvas and dependency tree.
- Verify STL export includes generated generic solids.

## Direction
Cadex should behave like a CAD feature modeler first. Domain-specific names can appear in user prompts, but the implementation should translate them into generic CAD features instead of exposing hard-coded part categories as the primary model.
