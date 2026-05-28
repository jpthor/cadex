#!/usr/bin/env node
/**
 * One-off helper: extract line ranges from App.tsx / SketchMode.tsx into module files.
 * Run from repo root: node scripts/extract-modules.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function extract(srcRel, destRel, start, end, header = "") {
  const src = path.join(root, srcRel);
  const lines = fs.readFileSync(src, "utf8").split("\n");
  const body = lines.slice(start - 1, end).join("\n");
  const dest = path.join(root, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, header + body + "\n");
  console.log(`Wrote ${destRel} (${end - start + 1} lines)`);
}

// App.tsx extractions (1-based line numbers)
const appChunks = [
  ["src/App.tsx", "src/lib/cadCommands.ts", 1576, 1635, ""],
  ["src/App.tsx", "src/lib/tauriRuntime.ts", 1637, 1653, ""],
  ["src/App.tsx", "src/lib/persistence.ts", 1655, 1781, ""],
  ["src/App.tsx", "src/components/ui/SettingsDialog.tsx", 1783, 1834, ""],
  ["src/App.tsx", "src/components/ui/ToolButton.tsx", 1836, 1852, ""],
  ["src/App.tsx", "src/components/ui/FormatMenu.tsx", 1854, 1913, ""],
  ["src/App.tsx", "src/components/ui/PanelTitle.tsx", 1915, 1922, ""],
  ["src/App.tsx", "src/components/design/ProjectMenu.tsx", 1924, 2033, ""],
  ["src/App.tsx", "src/components/propulsion/propulsionPanels.tsx", 815, 1574, ""],
  ["src/App.tsx", "src/components/sizing/sizingPanels.tsx", 1072, 1447, ""],
  ["src/App.tsx", "src/components/browser/browserModel.ts", 2854, 3065, ""],
  ["src/App.tsx", "src/components/browser/ProjectBrowser.tsx", 2035, 2853, ""],
  ["src/App.tsx", "src/components/design/TimelineItem.tsx", 3237, 3250, ""],
  ["src/App.tsx", "src/components/canvas/sceneHelpers.ts", 3110, 3235, ""],
  ["src/App.tsx", "src/components/canvas/selectionMath.ts", 3532, 3876, ""],
  ["src/App.tsx", "src/components/canvas/CadCanvas.tsx", 3252, 3530, ""],
];

for (const [src, dest, start, end, header] of appChunks) {
  extract(src, dest, start, end, header);
}

// SketchMode: geometry helpers (large tail)
extract("src/SketchMode.tsx", "src/sketch/geometry.ts", 2035, 4098, "");
extract("src/SketchMode.tsx", "src/sketch/panels.tsx", 776, 2033, "");
extract("src/SketchMode.tsx", "src/sketch/SketchSummaryFooter.tsx", 758, 774, "");
extract("src/SketchMode.tsx", "src/sketch/SketchWorkspace.tsx", 105, 756, "");

console.log("Done. Add imports to each extracted file manually or via follow-up script.");
