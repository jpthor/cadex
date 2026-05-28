# Cadex architecture

Cadex is a Tauri 2 desktop app: React + Three.js on the frontend, Rust CAD kernel and AI tool dispatch on the backend.

## Modes

| Mode | UI entry | Purpose |
|------|----------|---------|
| **Sizing** | `components/sizing/` | Mission requirements, draft aircraft metrics |
| **Sketch** | `SketchMode.tsx` | 2D planform sketch, dimensions, OpenVSP export |
| **Propulsion** | `components/propulsion/` | Motor / battery / propeller matching |
| **Design** | `App.tsx` + `components/canvas/` | 3D CAD viewport, copilot, browser, export |

Mode state lives in `App.tsx` (`appMode`). Shared aircraft state is `AircraftMasterState` in `app/types.ts` (project + sizing + propulsion), persisted via `lib/persistence.ts` and `/api/cad/projects/*` when the dev server API is available.

## Frontend layout

```
src/
├── App.tsx                 # Shell: mode switch, toolbar, orchestration (~750 lines)
├── app/                    # App-wide constants and types
├── lib/                    # Tauri helpers, persistence, CAD I/O commands
├── sizing/                 # Sizing domain model + audited analysis engine
│   ├── projectModel.ts     # Shapes, mission, normalizeSizingProject
│   ├── auditedSizingEngine.ts
│   └── index.ts            # Public sizing API
├── sizingEngine.ts         # Re-exports ./sizing (backward compatible)
├── propulsionEngine.ts     # Catalog samples + combo search
├── geometry.ts             # Three.js mesh builders, STL string export
├── ai.ts                   # Local + OpenAI design helpers
├── types.ts                # CAD project / object types (mirrors Rust model)
├── SketchMode.tsx          # Re-exports from sketch/ (compat)
├── sketch/
│   ├── SketchWorkspace.tsx # Sketch mode shell (~700 lines)
│   ├── SketchSummaryFooter.tsx
│   ├── geometry.ts         # Snap, projection, shape math (~1.4k lines)
│   ├── diagnostics.ts      # Aircraft panel analysis helpers
│   ├── types.ts, constants.ts
│   ├── panels/             # Aircraft, shape editor, shared fields
│   └── canvas/             # SketchCanvas, SizingGrid, SVG shape views
└── components/
    ├── ui/                 # PanelTitle, ToolButton, FormatMenu, Metric, Settings
    ├── design/             # ProjectMenu, TimelineItem
    ├── browser/            # ProjectBrowser, units, selection helpers
    ├── canvas/             # CadCanvas, scene helpers, picking math
    ├── sizing/             # SizingDashboard panels
    └── propulsion/         # PropulsionWorkspace, PropulsionNumberField
```

Import from `./sizing` for sizing types and analysis—not from `./sizingEngine` in new code.

## Backend layout

```
src-tauri/src/
├── main.rs              # Tauri commands (thin)
├── openvsp_sizing.rs    # OpenVSP / VSPAERO script from sizing JSON
├── openai_response.rs   # Parse OpenAI Responses API payloads
├── dispatch.rs          # Tool call → kernel / legacy
├── tools.rs             # Full AI tool catalog (implemented vs stub)
├── model.rs             # CadProject / CadObject types
├── legacy.rs            # Wings, STL, OpenVSP scripts
└── cad/                 # cadrum kernel (primitives, booleans, io, tessellate)
```

Kernel solids use opaque `kernel_handle` strings in the project; meshes are tessellated for the viewport. Legacy wings and imported meshes use separate export paths (see `export_model` in `main.rs`).

## Data flow (design mode)

1. User prompt → `runAiDesignCommand` (`lib/cadCommands.ts`) → Tauri `send_openai_tool_message` or browser `ai.ts`.
2. Rust runs OpenAI, `dispatch::run_tool` per function call, returns updated `CadProject`.
3. `CadCanvas` renders `project.objects` via `geometry.ts`.
4. STL/STEP export: `export_model` prefers kernel solids; wings fall back to OpenVSP scripts.

## Tests

- `npm run validate:sizing` / `validate:propulsion` — domain engine regression scripts
- `cd src-tauri && cargo test` — Rust (legacy parsers, kernel, OpenVSP sizing module)

## Further splits (optional)

- `sketch/geometry.ts` (~1.4k lines): could split pure math vs. projection helpers
- `sketch/canvas/shapeViews.tsx` (~600 lines): per-shape SVG components
