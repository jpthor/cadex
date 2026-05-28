#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function extract(srcRel, destRel, start, end) {
  const lines = fs.readFileSync(path.join(root, srcRel), "utf8").split("\n");
  return lines.slice(start - 1, end).join("\n");
}

function write(destRel, content) {
  const dest = path.join(root, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  console.log("Wrote", destRel, `(${content.split("\n").length} lines)`);
}

// --- ProjectBrowser ---
write(
  "src/components/browser/SelectionTable.tsx",
  `import type { SelectedGeometry } from "../../types";
import { formatVector, type DisplayUnit } from "./units";

export function SelectionTable({
  precision,
  selectedGeometry,
  unit,
}: {
  precision: number;
  selectedGeometry: SelectedGeometry;
  unit: DisplayUnit;
}) {
${extract("src/components/browser/ProjectBrowser.tsx", "", 29, 45).replace(/^/gm, "  ")}
}
`,
);

write(
  "src/components/browser/browserSections.tsx",
  `import { Box, ChevronDown, ChevronRight, Eye, EyeOff, Plane, Trash2 } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { CadObject, ReferenceGeometry, WingObject } from "../../types";
import type { BrowserGroupId } from "../../app/types";

export ${extract("src/components/browser/ProjectBrowser.tsx", "", 540, 761).replace(/^function /gm, "function ")}
`,
);

write(
  "src/components/browser/dependencyTree.tsx",
  `import { FolderTree } from "lucide-react";
import type { CadObject } from "../../types";
import type { BrowserGroupId } from "../../app/types";
import { PanelTitle } from "../ui/PanelTitle";
import { BrowserItemActions } from "./BrowserItemActions";

export type DependencyTreeNode = {
  id: string;
  label: string;
  children: DependencyTreeNode[];
};

${extract("src/components/browser/ProjectBrowser.tsx", "", 771, 1012)}
`,
);

write(
  "src/components/browser/BrowserItemActions.tsx",
  `import { Eye, EyeOff, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";

${extract("src/components/browser/ProjectBrowser.tsx", "", 978, 1012).replace(/^function BrowserItemActions/, "export function BrowserItemActions")}
`,
);

// Fix dependencyTree - BrowserItemActions was duplicated, re-extract dependency without BrowserItemActions
const depBody = extract("src/components/browser/ProjectBrowser.tsx", "", 771, 977);
write(
  "src/components/browser/dependencyTree.tsx",
  `import { FolderTree, Orbit, Crosshair } from "lucide-react";
import type { CadObject } from "../../types";
import type { BrowserGroupId } from "../../app/types";
import { PanelTitle } from "../ui/PanelTitle";
import { BrowserItemActions } from "./BrowserItemActions";

export type DependencyTreeNode = {
  id: string;
  label: string;
  children: DependencyTreeNode[];
};

${depBody.replace(/^function /gm, "export function ").replace(/^type DependencyTreeNode[\s\S]*?};\n\n/, "")}
`,
);

// --- SketchMode ---
write("src/sketch/types.ts", extract("src/SketchMode.tsx", "", 61, 72) + "\n\n" + extract("src/SketchMode.tsx", "", 2074, 2075));

write(
  "src/sketch/constants.ts",
  fs.readFileSync(path.join(root, "src/sketch/constants.ts"), "utf8").trim() +
    "\n\nimport type { CanvasView, ScaleUnit } from \"./types\";\nimport type { PartType, SizeShapeRole } from \"../sizing\";\n\n" +
    extract("src/SketchMode.tsx", "", 60, 72).replace(/type ScaleUnit.*\n/, "export type { ScaleUnit } from \"./types\";\n"),
);

// Fix constants - read current and append properly
const existingConstants = fs.readFileSync(path.join(root, "src/sketch/constants.ts"), "utf8");
write(
  "src/sketch/constants.ts",
  existingConstants.split("].sort")[0] +
    "].sort((a, b) => a.thrustN - b.thrustN);\n\n" +
    `import type { CanvasView } from "./types";
import type { PartType, SizeShapeRole } from "../sizing";

export const baseCanvasView: CanvasView = { width: 900, height: 720, originX: 450, originY: 72, scale: 190 };
export const scaleUnits = ["cm", "m", "mm"] as const;
export const referenceRoles: SizeShapeRole[] = ["referenceLine", "mirrorPlane"];
export const airfoilOptions = ["NACA 0012", "NACA 2412", "NACA 4412", "Clark Y", "MH 32", "Selig S1223"];
export const mirrorAxisTouchToleranceM = 0.005;
export const drawablePartTypes: PartType[] = ["payload", "battery", "motor", "rotor"];
export const sideCollapseProgress = 0.58;
`,
);

write(
  "src/sketch/types.ts",
  `import type { SizeDimensionTarget } from "../sizing";

export const scaleUnits = ["cm", "m", "mm"] as const;
export type ScaleUnit = (typeof scaleUnits)[number];
export type AirfoilStation = "root10" | "tip90";
export type CanvasViewMode = "top" | "front" | "side";
export type JoinPointSelection = { shapeId: string; pointIndex: number };
export type DimensionDraft = { firstTarget: SizeDimensionTarget } | null;
export type PendingDimension = { targetA: SizeDimensionTarget; targetB: SizeDimensionTarget } | null;
export type CanvasView = { width: number; height: number; originX: number; originY: number; scale: number };
export type SideProjectionFrame = { baselineY: number; longitudinalSign: 1 | -1 };
`,
);

write(
  "src/sketch/diagnostics.ts",
  `import type { PartType, SizeShape, SizingProject } from "../sizing";
import { computeSizingAnalysis } from "../sizing/auditedSizingEngine";

export type AircraftDiagnostic = {
  level: "error" | "warning";
  title: string;
  detail: string;
};

${extract("src/SketchMode.tsx", "", 918, 1079).replace(/^function /gm, "export function ")}
`,
);

write(
  "src/sketch/panels/shared.tsx",
  `import type { ReactNode } from "react";

${extract("src/SketchMode.tsx", "", 745, 753).replace(/^function /, "export function ")}
${extract("src/SketchMode.tsx", "", 1362, 1398).replace(/^function NumberField/, "export function NumberField").replace(/^function Metric/, "export function Metric")}
`,
);

write(
  "src/sketch/panels/aircraftPanel.tsx",
  `import { Eye, EyeOff, Gauge, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { SizingProject } from "../../sizing";
import { defaultTurbineCount, turbineEngineOptions } from "../constants";
import { analyseAircraftSizing, type AircraftDiagnostic } from "../diagnostics";
import { SketchPanelTitle } from "./shared";

${extract("src/SketchMode.tsx", "", 754, 917).replace(/^function EngineComputePanel/, "export function EngineComputePanel").replace(/^function AircraftPanel/, "export function AircraftPanel").replace(/^function DeleteAircraftControl/, "export function DeleteAircraftControl").replace(/^type AircraftDiagnostic[\s\S]*?};\n\n/, "").replace(/^function AircraftDiagnostics/, "export function AircraftDiagnostics")}
`,
);

write(
  "src/sketch/panels/shapeEditor.tsx",
  `import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
  bodyMaterialLabels,
  liftingSurfaceKindLabels,
  partTypeLabels,
  roleLabels,
} from "../../sizing";
import type {
  BodyMaterial,
  LiftingSurfaceKind,
  PartType,
  SizeShape,
  SizeShapeRole,
  SizingProject,
} from "../../sizing";
import { airfoilOptions } from "../constants";
import { NumberField, SketchPanelTitle } from "./shared";

${extract("src/SketchMode.tsx", "", 1080, 1361).replace(/^function ShapeSelector/, "export function ShapeSelector").replace(/^function ShapeEditor/, "export function ShapeEditor")}
`,
);

write(
  "src/sketch/geometry/math.ts",
  `${extract("src/SketchMode.tsx", "", 2077, 2383).replace(/^function /gm, "export function ").replace(/^type CanvasView[\s\S]*?};\n\n/, "").replace(/^type SideProjectionFrame[\s\S]*?};\n\n/, "")}
${extract("src/SketchMode.tsx", "", 2958, 4067).replace(/^function /gm, "export function ")}
`,
);

write(
  "src/sketch/canvas/shapeViews.tsx",
  `import type { MouseEvent, PointerEvent } from "react";
import type {
  SizeDimension,
  SizeDimensionTarget,
  SizePoint,
  SizeShape,
  SizingAnalysis,
} from "../../sizing";
import type { CanvasView } from "../types";
import {
  pathForPoints,
  closedPathForPoints,
  toCanvas,
} from "../geometry/math";
import { curveControlForSegment } from "../geometry/math";

${extract("src/SketchMode.tsx", "", 2384, 2956).replace(/^function /gm, "export function ")}
`,
);

// curveControlForSegment is in 2797-2815 - included in shapeViews range? 2384-2956 includes it at 2797

write(
  "src/sketch/canvas/SizingGrid.tsx",
  `import type { CanvasView, ScaleUnit } from "../types";
import { chooseMajorTickMeters, chooseMinorTickMeters, formatScaleValue, isPointVisible } from "../geometry/math";
import { scaleUnits } from "../constants";

${extract("src/SketchMode.tsx", "", 2004, 2072).replace(/^function SizingGrid/, "export function SizingGrid")}
`,
);

console.log("Extracted chunks. Run manual header fixes for SketchCanvas and SketchWorkspace.");
