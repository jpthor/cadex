import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  bodyMassEstimate,
  liftingSurfaceMassEstimate,
  liftingSurfaceStats,
  partMassEstimate,
  shapeBounds,
} from "../../sizing/auditedSizingEngine";
import type { SizeShape, SizingAnalysis } from "../../sizing";
import { defaultTurbineCount, referenceRoles, turbineEngineOptions } from "../constants";
import {
  computeTailplaneSize,
  countParts,
  type AircraftDiagnostic,
} from "../diagnostics";
import { Metric, NumberField, SketchPanelTitle } from "./shared";
export function EngineComputePanel() {
  const [engineId, setEngineId] = useState("swiwin-sw60b");
  const [enduranceMin, setEnduranceMin] = useState(20);
  const selectedEngine = turbineEngineOptions.find((engine) => engine.id === engineId) ?? turbineEngineOptions[0];
  const safeEnduranceMin = Number.isFinite(enduranceMin) ? Math.max(0, enduranceMin) : 0;
  const engineWeightKg = selectedEngine.engineWeightKg * defaultTurbineCount;
  const fuelWeightKg = selectedEngine.fuelKgPerMin * safeEnduranceMin * defaultTurbineCount;
  const totalWeightKg = engineWeightKg + fuelWeightKg;

  return (
    <div className="aircraft-panel engine-compute-panel">
      <div className="aircraft-parameter-title">Jet aero</div>
      <label className="sizing-field">
        <span>Engine</span>
        <div>
          <select value={engineId} onChange={(event) => setEngineId(event.target.value)}>
            {turbineEngineOptions.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.maker} {engine.model} - {engine.thrustN} N
              </option>
            ))}
          </select>
        </div>
      </label>
      <NumberField label="Endurance time" suffix="min" value={enduranceMin} step={1} onChange={setEnduranceMin} />
      <div className="engine-compute-spec">
        <span>{selectedEngine.maker} {selectedEngine.model}</span>
        <strong>{selectedEngine.thrustN * defaultTurbineCount} N total thrust</strong>
      </div>
      <Metric label="Engine weight x2" value={`${engineWeightKg.toFixed(2)} kg`} />
      <Metric label="Fuel weight x2" value={`${fuelWeightKg.toFixed(2)} kg`} />
      <div className="aircraft-mass-readout engine-compute-total">
        <span>Total</span>
        <strong>{totalWeightKg.toFixed(2)} kg</strong>
      </div>
      <p className="engine-compute-note">
        Fuel uses full-power published burn where available. Source: {selectedEngine.source}.
      </p>
    </div>
  );
}

export function AircraftPanel({
  analysis,
  shapes,
  onDeleteAircraft,
}: {
  analysis?: SizingAnalysis;
  shapes: SizeShape[];
  onDeleteAircraft: () => void;
}) {
  const shapeCount = shapes.filter((shape) => !referenceRoles.includes(shape.role)).length;
  const partCounts = countParts(shapes);
  const tailplaneSize = computeTailplaneSize(shapes);
  const wingSummary = useMemo(() => computeNamedLiftingSurfaceSummary(shapes, "wing"), [shapes]);
  const massBreakdown = useMemo(() => computeMassBreakdown(shapes), [shapes]);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  function handleDeleteAircraft() {
    if (!deleteConfirming) {
      setDeleteConfirming(true);
      return;
    }
    setDeleteConfirming(false);
    onDeleteAircraft();
  }
  function cancelDeleteAircraft() {
    setDeleteConfirming(false);
  }
  if (!analysis) {
    return (
      <div className="aircraft-panel">
        <p className="empty-text">Draw an aircraft shape to see mass and parameters.</p>
        <DeleteAircraftControl
          confirming={deleteConfirming}
          disabled={!shapeCount}
          onCancel={cancelDeleteAircraft}
          onDelete={handleDeleteAircraft}
        />
      </div>
    );
  }
  return (
    <div className="aircraft-panel">
      <div className="aircraft-mass-readout">
        <span>Actual mass</span>
        <strong>{analysis.totalMassKg.toFixed(2)} kg</strong>
      </div>
      <div className="aircraft-parameter-title">Actual mass breakdown</div>
      <Metric label="Bodies" value={`${massBreakdown.bodiesKg.toFixed(2)} kg`} />
      <Metric label="Lifting surfaces" value={`${massBreakdown.liftingKg.toFixed(2)} kg`} />
      <Metric label="Battery" value={`${massBreakdown.batteryKg.toFixed(2)} kg`} />
      <Metric label="Motors" value={`${massBreakdown.motorKg.toFixed(2)} kg`} />
      <Metric label="Rotors" value={`${massBreakdown.rotorKg.toFixed(2)} kg`} />
      <Metric label="Payload" value={partCounts.payload ? `${massBreakdown.payloadKg.toFixed(2)} kg` : "not drawn"} />
      <Metric label="Electronics" value={partCounts.electronics ? `${massBreakdown.electronicsKg.toFixed(2)} kg` : "not drawn"} />
      <Metric label="Total actual mass" value={`${massBreakdown.totalKg.toFixed(2)} kg`} />
      <div className="aircraft-parameter-title">Parameters</div>
      <Metric label="Elements" value={`${shapeCount}`} />
      <Metric label="Motors" value={`${partCounts.motor}`} />
      {partCounts.rotor ? <Metric label="Rotors" value={`${partCounts.rotor}`} /> : null}
      {partCounts.payload ? <Metric label="Payloads" value={`${partCounts.payload}`} /> : null}
      {partCounts.battery ? <Metric label="Batteries" value={`${partCounts.battery}`} /> : null}
      {partCounts.electronics ? <Metric label="Electronics" value={`${partCounts.electronics}`} /> : null}
      {wingSummary.sections > 1 ? <Metric label="Wing sections" value={`${wingSummary.sections}`} /> : null}
      <Metric label="Wing area" value={`${wingSummary.areaM2.toFixed(3)} m2`} />
      {wingSummary.spanM > 0 ? <Metric label="Wing span" value={`${wingSummary.spanM.toFixed(2)} m`} /> : null}
      {tailplaneSize.count ? <Metric label="Tailplane area" value={`${tailplaneSize.areaM2.toFixed(3)} m2`} /> : null}
      {tailplaneSize.count ? <Metric label="Tailplane span" value={`${tailplaneSize.spanM.toFixed(2)} m`} /> : null}
      <Metric label="Mean chord" value={`${(wingSummary.meanChordM || analysis.meanChordM).toFixed(3)} m`} />
      <DeleteAircraftControl
        confirming={deleteConfirming}
        disabled={!shapeCount}
        onCancel={cancelDeleteAircraft}
        onDelete={handleDeleteAircraft}
      />
    </div>
  );
}

function computeMassBreakdown(shapes: SizeShape[]) {
  return shapes.reduce(
    (totals, shape) => {
      if (shape.role === "body") {
        const massKg = bodyMassEstimate(shape, shapes);
        totals.bodiesKg += massKg;
        totals.totalKg += massKg;
      }
      if (shape.role === "liftingSurface") {
        const massKg = liftingSurfaceMassEstimate(shape, shapes);
        totals.liftingKg += massKg;
        totals.totalKg += massKg;
      }
      if (shape.role === "part") {
        const massKg = partMassEstimate(shape, shapes);
        const partType = shape.partType ?? "payload";
        if (partType === "battery") totals.batteryKg += massKg;
        if (partType === "motor") totals.motorKg += massKg;
        if (partType === "rotor") totals.rotorKg += massKg;
        if (partType === "payload") totals.payloadKg += massKg;
        if (partType === "electronics") totals.electronicsKg += massKg;
        totals.totalKg += massKg;
      }
      return totals;
    },
    { batteryKg: 0, bodiesKg: 0, electronicsKg: 0, liftingKg: 0, motorKg: 0, payloadKg: 0, rotorKg: 0, totalKg: 0 },
  );
}

function computeNamedLiftingSurfaceSummary(shapes: SizeShape[], name: "wing") {
  const sections = shapes.filter((shape) => {
    if (shape.role !== "liftingSurface") return false;
    const kind = shape.liftingSurfaceKind ?? "wing";
    return kind === name || shape.label.toLowerCase().includes(name);
  });
  let areaM2 = 0;
  let localSpanM = 0;
  for (const section of sections) {
    const stats = liftingSurfaceStats(section, shapes);
    const bounds = shapeBounds(section);
    areaM2 += stats.areaM2;
    localSpanM += Math.max(bounds.maxX - bounds.minX, 0);
  }
  const spanM = localSpanM > 0 ? localSpanM * 2 : 0;
  return {
    areaM2,
    meanChordM: spanM > 0 ? areaM2 / spanM : 0,
    sections: sections.length,
    spanM,
  };
}

export function DeleteAircraftControl({
  confirming,
  disabled,
  onCancel,
  onDelete,
}: {
  confirming: boolean;
  disabled: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`delete-aircraft-confirm ${confirming ? "confirming" : ""}`}>
      <button className="delete-component-button" disabled={disabled} onClick={onDelete}>
        <Trash2 size={15} />
        {confirming ? "Confirm delete" : "Delete aircraft"}
      </button>
      {confirming ? (
        <button className="delete-cancel-button" onClick={onCancel} type="button">
          Cancel
        </button>
      ) : null}
    </div>
  );
}

export function AircraftDiagnostics({ diagnostics }: { diagnostics: AircraftDiagnostic[] }) {
  if (!diagnostics.length) {
    return <p className="empty-text">No aircraft geometry to analyse yet.</p>;
  }
  return (
    <div className="aircraft-diagnostics">
      {diagnostics.map((diagnostic) => (
        <div className={`aircraft-diagnostic ${diagnostic.level}`} key={diagnostic.label}>
          <div>
            <span>{diagnostic.label}</span>
            <strong>{diagnostic.value}</strong>
          </div>
          <p>{diagnostic.message}</p>
        </div>
      ))}
    </div>
  );
}
