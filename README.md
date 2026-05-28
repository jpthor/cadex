# Cadex

Generic parametric CAD designer for aircraft-scale work. Tauri 2 desktop shell, React + Three.js viewport, Rust CAD kernel, optional OpenAI tool calling, and export paths.

See `PLAN.md` for the product brief and `ARCHITECTURE.md` for how the repo is organized.

## Stack

- **Shell:** Tauri 2 (`src-tauri/`)
- **Frontend:** React 19 + TypeScript + Vite (`src/`)
- **Viewport:** Three.js (`src/geometry.ts`, `src/components/canvas/`)
- **Sizing / propulsion:** TypeScript engines under `src/sizing/`, `src/propulsionEngine.ts`
- **Geometry kernel (export path):** cadrum / OpenCASCADE via `src-tauri/src/cad/`; legacy wings via OpenVSP when installed
- **AI copilot (optional):** OpenAI Responses API with function tool calling

## Prerequisites

- Node.js 18+
- Rust toolchain (`rustup` stable)
- macOS, Windows, or Linux Tauri 2 prerequisites — see <https://tauri.app/start/prerequisites/>
- Optional: [OpenVSP](https://openvsp.org) on `PATH` for STEP export and sizing VSPAERO scripts

## Install

```bash
npm install
```

## Run

```bash
npm run tauri:dev
```

This starts Vite on `http://127.0.0.1:1420` and launches the Tauri window.

## Build

```bash
npm run build         # type-check + frontend bundle into dist/
npm run tauri:build   # full desktop bundle in src-tauri/target/release/
```

## Test

```bash
npm test                              # sizing + propulsion validation scripts
cd src-tauri && cargo test            # Rust unit tests
```

## Using the app

1. Launch the app (`npm run tauri:dev`).
2. Use **Sizing** / **Sketch** / **Propulsion** for aircraft layout and powertrain, or **Design** for parametric CAD.
3. In Design mode, enter a prompt (e.g. `create a 40mm diameter round solid, 120mm long, on the XZ plane`) and press **Build**.
4. Export **STL** or **STEP** from the toolbar when geometry exists.

### Optional: OpenAI copilot

Paste an OpenAI API key in Settings. Cadex calls the Responses API with kernel tools (`create_box`, `extrude_polygon`, booleans, etc.) and legacy wing tools. The API key is stored in browser local storage.

## Project layout

```
cadex/
├── ARCHITECTURE.md
├── PLAN.md
├── src/                    # React frontend (see ARCHITECTURE.md)
└── src-tauri/              # Rust backend
    └── src/
        ├── main.rs
        ├── cad/            # Kernel
        ├── dispatch.rs     # AI tool routing
        ├── openvsp_sizing.rs
        └── openai_response.rs
```
