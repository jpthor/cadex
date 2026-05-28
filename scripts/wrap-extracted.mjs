#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function wrap(destRel, header, bodyTransform = (b) => b) {
  const dest = path.join(root, destRel);
  let body = fs.readFileSync(dest, "utf8");
  body = bodyTransform(body);
  fs.writeFileSync(dest, header + body);
  console.log("Wrapped", destRel);
}

wrap("src/components/ui/SettingsDialog.tsx", `import { defaultModel } from "../../app/constants";

`);
wrap("src/components/ui/PanelTitle.tsx", `import type { ReactNode } from "react";

`);
wrap("src/components/design/TimelineItem.tsx", `import type { TimelineEvent } from "../../types";

`);

wrap(
  "src/components/propulsion/propulsionPanels.tsx",
  `import { Fan } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  batterySamples,
  computePropulsionSizing,
  findBestPropulsionCombo,
  motorSamples,
  propellerMassEstimate,
  propellerSamples,
} from "../../propulsionEngine";
import type { PropulsionInputs, RotorDefinition } from "../../propulsionEngine";
import { metersPerSecondPerKnot } from "../../app/constants";
import type { PropulsionTabState } from "../../app/types";
import type { SizingProject } from "../../sizing";

export `,
  (b) => b.replace(/^function PropulsionWorkspace/, "export function PropulsionWorkspace").replace(/^function (Motor|Battery|Propeller|Propulsion|Result|Metric|apply)/gm, "export function $1"),
);

wrap(
  "src/components/sizing/sizingPanels.tsx",
  `import { Gauge, Ruler } from "lucide-react";
import { useMemo } from "react";
import { metersPerSecondPerKnot } from "../../app/constants";
import type { SizingProject } from "../../sizing";
import type { SizingAnalysis } from "../../sizing";

export `,
  (b) => b.replace(/^function SizingDashboard/, "export function SizingDashboard").replace(/^function /gm, "export function "),
);

console.log("Done wrap");
