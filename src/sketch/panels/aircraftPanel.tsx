import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { computeSizingAnalysis } from "../../sizing/auditedSizingEngine";
import type { SizeShape, SizingAnalysis } from "../../sizing";
import { defaultTurbineCount, referenceRoles, turbineEngineOptions } from "../constants";
import {
  analyseAircraftSizing,
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
      <div className="aircraft-parameter-title">Jet compute</div>
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
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const diagnostics = analysis ? analyseAircraftSizing(shapes, analysis, partCounts, tailplaneSize) : [];
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
        <span>Mass</span>
        <strong>{analysis.totalMassKg.toFixed(2)} kg</strong>
      </div>
      <div className="aircraft-parameter-title">Parameters</div>
      <Metric label="Elements" value={`${shapeCount}`} />
      <Metric label="Motors" value={`${partCounts.motor}`} />
      {partCounts.rotor ? <Metric label="Rotors" value={`${partCounts.rotor}`} /> : null}
      {partCounts.payload ? <Metric label="Payloads" value={`${partCounts.payload}`} /> : null}
      {partCounts.battery ? <Metric label="Batteries" value={`${partCounts.battery}`} /> : null}
      {partCounts.electronics ? <Metric label="Electronics" value={`${partCounts.electronics}`} /> : null}
      <Metric label="Wing area" value={`${analysis.wingAreaM2.toFixed(3)} m2`} />
      {tailplaneSize.count ? <Metric label="Tailplane area" value={`${tailplaneSize.areaM2.toFixed(3)} m2`} /> : null}
      {tailplaneSize.count ? <Metric label="Tailplane span" value={`${tailplaneSize.spanM.toFixed(2)} m`} /> : null}
      <Metric label="Mean chord" value={`${analysis.meanChordM.toFixed(3)} m`} />
      <button className="analyse-aircraft-button" disabled={!shapeCount} onClick={() => setAnalysisVisible((visible) => !visible)}>
        Analyse
      </button>
      {analysisVisible ? <AircraftDiagnostics diagnostics={diagnostics} /> : null}
      <DeleteAircraftControl
        confirming={deleteConfirming}
        disabled={!shapeCount}
        onCancel={cancelDeleteAircraft}
        onDelete={handleDeleteAircraft}
      />
    </div>
  );
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
