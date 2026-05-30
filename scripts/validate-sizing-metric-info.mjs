import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sizingInputInfo } from "../src/components/sizing/sizingInputInfo.ts";
import { sizingMetricInfo } from "../src/components/sizing/sizingMetricInfo.ts";

const source = readFileSync(new URL("../src/components/sizing/sizingPanels.tsx", import.meta.url), "utf8");
const labels = [...source.matchAll(/<SizingMetric\s+label="([^"]+)"/g)].map((match) => match[1]);
const uniqueLabels = [...new Set(labels)].sort((a, b) => a.localeCompare(b));
const catalogLabels = Object.keys(sizingMetricInfo).sort((a, b) => a.localeCompare(b));
const missing = uniqueLabels.filter((label) => !sizingMetricInfo[label]);
const stale = catalogLabels.filter((label) => !uniqueLabels.includes(label));
const inputLabels = [
  ...source.matchAll(/<PropulsionNumberField\s+[^>]*label="([^"]+)"/g),
  ...source.matchAll(/<SizingInputLabel\s+label="([^"]+)"/g),
].map((match) => match[1]);
const uniqueInputLabels = [...new Set(inputLabels)].sort((a, b) => a.localeCompare(b));
const inputCatalogLabels = Object.keys(sizingInputInfo).sort((a, b) => a.localeCompare(b));
const missingInput = uniqueInputLabels.filter((label) => !sizingInputInfo[label]);
const staleInput = inputCatalogLabels.filter((label) => !uniqueInputLabels.includes(label));

assert.equal(labels.length > 0, true, "Sizing page exposes metric labels");
assert.deepEqual(missing, [], `Missing sizing metric info: ${missing.join(", ")}`);
assert.deepEqual(stale, [], `Stale sizing metric info entries: ${stale.join(", ")}`);
assert.equal(inputLabels.length > 0, true, "Sizing page exposes input labels");
assert.deepEqual(missingInput, [], `Missing sizing input info: ${missingInput.join(", ")}`);
assert.deepEqual(staleInput, [], `Stale sizing input info entries: ${staleInput.join(", ")}`);

console.log(`Sizing info validation passed: ${uniqueLabels.length} metric labels and ${uniqueInputLabels.length} input labels linked.`);
