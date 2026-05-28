#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const appPath = path.join(root, "src/App.tsx");
const lines = fs.readFileSync(appPath, "utf8").split("\n");

const imports = `import { invoke } from "@tauri-apps/api/core";
import {
  Crosshair,
  Download,
  Fan,
  Gauge,
  Hand,
  Maximize,
  MessageSquareText,
  MousePointer2,
  Orbit,
  Ruler,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  ZoomIn,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { isKernelBridgeAvailable, runLocalDesignCommand } from "./ai";
import {
  defaultModel,
  defaultPropulsionTabState,
  examplePrompt,
  fixedAircraftMotorCount,
} from "./app/constants";
import type { AppMode, AircraftMasterState, AircraftProjectEntry, CursorPlane, OpenVspSizingResult, PropulsionTabState } from "./app/types";
import { ProjectBrowser } from "./components/browser/ProjectBrowser";
import { CadCanvas } from "./components/canvas/CadCanvas";
import { updateActiveCursorPlane } from "./components/canvas/cursorPlane";
import { tupleToVector } from "./components/canvas/vectorUtils";
import { ProjectMenu } from "./components/design/ProjectMenu";
import { TimelineItem } from "./components/design/TimelineItem";
import { PropulsionWorkspace } from "./components/propulsion/propulsionPanels";
import { SizingDashboard } from "./components/sizing/sizingPanels";
import { FormatMenu } from "./components/ui/FormatMenu";
import { PanelTitle } from "./components/ui/PanelTitle";
import { SettingsDialog } from "./components/ui/SettingsDialog";
import { ToolButton } from "./components/ui/ToolButton";
import { exportCurrentProject, importIntoProject, runAiDesignCommand } from "./lib/cadCommands";
import { fallbackProject } from "./lib/projectDefaults";
import {
  buildAircraftMasterState,
  createAircraftProject,
  deleteAircraftProject,
  fetchAircraftProject,
  listAircraftProjects,
  loadStoredProject,
  normalizeCadProject,
  normalizePropulsionTabState,
  persistAircraftProject,
  upsertAircraftProject,
} from "./lib/persistence";
import { friendlyError, isTauriRuntime } from "./lib/tauriRuntime";
import { batteryMassFromSizing, rotorDefinitionFromSizing } from "./propulsionEngine";
import { SketchWorkspace, SketchSummaryFooter } from "./SketchMode";
import { computeSizingAnalysis, defaultSizingProject, normalizeSizingProject } from "./sizing";
import type { SizingProject } from "./sizing";
import type { CadProject, GeometryFormat, SelectedGeometry, ToolMode } from "./types";
import { browserGroupIdForObject, selectionFromBrowserItem } from "./components/browser/browserSelection";
`;

// Keep lines 111-814 (1-based) = index 110-813
const body = lines.slice(110, 814).join("\n");
const out = imports + "\n" + body + "\n";
fs.writeFileSync(path.join(root, "src/App.new.tsx"), out);
console.log("Wrote src/App.new.tsx", out.split("\n").length, "lines");
