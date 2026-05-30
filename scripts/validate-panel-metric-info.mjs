import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeMetricInfo } from "../src/components/compute/computeMetricInfo.ts";
import { jetMetricInfo } from "../src/components/jet/jetMetricInfo.ts";
import { propulsionMetricInfo } from "../src/components/propulsion/propulsionMetricInfo.ts";

const panels = [
  {
    name: "Aero",
    files: ["../src/components/compute/ComputeDashboard.tsx"],
    catalog: computeMetricInfo,
    components: ["ComputeMetric", "ComputeMetricTile", "InlineInfoLabel", "CurveChart"],
    dynamicLabels: ["Actual usable", "Sizing usable"],
  },
  {
    name: "Propulsion",
    files: ["../src/components/propulsion/propulsionPanels.tsx"],
    catalog: propulsionMetricInfo,
    components: ["PropulsionMetric", "PropulsionMetricTile", "PropulsionNumberField", "PropulsionFieldLabel"],
    dynamicLabels: [
      "Battery (Actual)",
      "Battery (Sizing)",
      "Diameter (Actual)",
      "Diameter (Sizing)",
      "Rotors (Actual)",
      "Rotors (Sizing)",
    ],
  },
  {
    name: "Jet",
    files: ["../src/components/jet/JetDashboard.tsx", "../src/components/jet/IJetDashboard.tsx"],
    catalog: jetMetricInfo,
    components: ["JetMetric", "JetMetricTile", "PropulsionNumberField", "JetFieldLabel"],
    dynamicLabels: [],
  },
];

function sourceFor(files) {
  return files.map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
}

function labelsFor(source, components) {
  return [
    ...new Set(
      components.flatMap((component) => {
        const regex = new RegExp(`<${component}\\b[^>]*label="([^"]+)"`, "g");
        return [...source.matchAll(regex)].map((match) => match[1]);
      }),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function hasInfo(catalog, label) {
  const normalized = label.replace(/\s+\([^)]*\)/g, "");
  return Boolean(catalog[label] ?? catalog[normalized]);
}

for (const panel of panels) {
  const source = sourceFor(panel.files);
  const labels = labelsFor(source, panel.components);
  const expectedLabels = [...new Set([...labels, ...panel.dynamicLabels])].sort((a, b) => a.localeCompare(b));
  const catalogLabels = Object.keys(panel.catalog).sort((a, b) => a.localeCompare(b));
  const missing = expectedLabels.filter((label) => !hasInfo(panel.catalog, label));
  const stale = catalogLabels.filter((label) => !expectedLabels.some((expected) => label === expected || label === expected.replace(/\s+\([^)]*\)/g, "")));

  assert.equal(labels.length > 0, true, `${panel.name} page exposes metric labels`);
  assert.deepEqual(missing, [], `Missing ${panel.name} info: ${missing.join(", ")}`);
  assert.deepEqual(stale, [], `Stale ${panel.name} info entries: ${stale.join(", ")}`);

  console.log(`${panel.name} info validation passed: ${expectedLabels.length} labels linked.`);
}
