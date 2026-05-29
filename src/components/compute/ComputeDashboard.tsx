import { invoke } from "@tauri-apps/api/core";
import { Activity, AlertTriangle, Calculator, Gauge, Wind } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { batteryMassEstimate, computeSketchAerodynamics, computeSizingAnalysis } from "../../sizing";
import type { SizingProject } from "../../sizing";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import { Metric } from "../ui/Metric";

type MachUpXReport = {
  ok: boolean;
  solver?: string;
  message?: string;
  targetCL?: number;
  result?: {
    ok: boolean;
    message?: string;
    targetCL?: number;
    alphaDeg?: number;
    CL?: number;
    CD?: number;
    Cm?: number;
    LD?: number;
    low?: { alphaDeg?: number; CL?: number; CD?: number };
    high?: { alphaDeg?: number; CL?: number; CD?: number };
    sample?: { alphaDeg?: number; CL?: number; CD?: number };
    solverOutputs?: {
      forces?: MachUpXCall<{
        total?: Record<string, number | null>;
        segments?: Array<Record<string, number | string | null>>;
      }>;
      aeroCenter?: MachUpXCall<{
        cadex?: {
          aero_center?: number[];
          Cm_ac?: number;
        };
      }>;
      stabilityDerivatives?: MachUpXCall<{ cadex?: Record<string, number> }>;
      dampingDerivatives?: MachUpXCall<{ cadex?: Record<string, number> }>;
      spanwise?: {
        ok: boolean;
        surfaceCount?: number;
        maxSectionCL?: number | null;
        minSectionCL?: number | null;
        meanSectionCL?: number | null;
        maxRe?: number | null;
        surfaces?: Array<{
          name: string;
          stations: number;
          maxSectionCL?: number | null;
          meanSectionCL?: number | null;
          maxRe?: number | null;
          meanAlphaDeg?: number | null;
        }>;
      };
      pitchTrim?: MachUpXCall<unknown>;
    };
  };
};

type MachUpXCall<T> = { ok: true; value: T } | { ok: false; message?: string };

export function ComputeDashboard({ project, projectName }: { project: SizingProject; projectName: string }) {
  const analysis = useMemo(() => (project.shapes.length ? computeSizingAnalysis(project) : undefined), [project]);
  const aero = useMemo(() => (project.shapes.length ? computeSketchAerodynamics(project) : undefined), [project]);
  const [machUpX, setMachUpX] = useState<MachUpXReport | undefined>();
  const hasMachUpXSurface = project.shapes.some(
    (shape) => shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") === "wing" && shape.points.length >= 3,
  );

  useEffect(() => {
    let cancelled = false;
    if (!hasMachUpXSurface) {
      setMachUpX(undefined);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const request = { projectName, sizing: project };
      const solverRequest = isTauriRuntime()
        ? invoke<MachUpXReport>("analyze_sizing_machupx", { request })
        : fetch("/api/machupx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          }).then((response) => response.json() as Promise<MachUpXReport>);

      solverRequest
        .then((report) => {
          if (!cancelled) setMachUpX(report);
        })
        .catch(() => {
          if (!cancelled) setMachUpX(undefined);
        });
    }, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasMachUpXSurface, project, projectName]);

  const machResult = machUpX?.ok && machUpX.result?.ok ? machUpX.result : undefined;
  const machAttempt = machUpX?.ok ? machUpX.result : undefined;
  const machSolver = machResult?.solverOutputs ?? machAttempt?.solverOutputs;
  const machAc = machSolver?.aeroCenter?.ok ? machSolver.aeroCenter.value.cadex : undefined;
  const machStability = machSolver?.stabilityDerivatives?.ok ? machSolver.stabilityDerivatives.value.cadex : undefined;
  const machDamping = machSolver?.dampingDerivatives?.ok ? machSolver.dampingDerivatives.value.cadex : undefined;
  const machSpanwise = machSolver?.spanwise?.ok ? machSolver.spanwise : undefined;
  const machTrim = machSolver?.pitchTrim;
  const machAcCadexX = typeof machAc?.aero_center?.[0] === "number" ? -machAc.aero_center[0] : undefined;
  const machStaticMarginCadexPct =
    typeof machAcCadexX === "number" && (aero?.geometry.meanChordM ?? 0) > 0
      ? (((aero?.stability.centerOfMassY ?? 0) - machAcCadexX) / (aero?.geometry.meanChordM ?? 1)) * 100
      : undefined;
  const machClVerification = machResult?.CL !== undefined
    ? `MachUpX verified: ${machResult.CL.toFixed(3)}`
    : machAttempt?.CL !== undefined
      ? `MachUpX nearest: ${machAttempt.CL.toFixed(3)}`
      : undefined;
  const machCdVerification = machResult?.CD !== undefined
    ? `MachUpX lifting only: ${machResult.CD.toFixed(3)}`
    : machAttempt?.CD !== undefined
      ? `MachUpX nearest lifting: ${machAttempt.CD.toFixed(3)}`
      : undefined;
  const machLdVerification = machResult?.LD !== undefined
    ? `MachUpX lifting only: ${machResult.LD.toFixed(1)}`
    : machAttempt?.LD !== undefined
      ? `MachUpX nearest lifting: ${machAttempt.LD.toFixed(1)}`
      : undefined;
  const clVerdict = aero ? cruiseClVerdict(aero.aerodynamics.liftCoefficient, aero.validity.lift) : undefined;
  const cdVerdict = aero ? cdVerdictFor(aero.aerodynamics.dragCoefficient, aero.validity.drag) : undefined;
  const ldVerdict = aero ? liftToDragVerdict(aero.aerodynamics.liftToDrag, aero.validity.lift) : undefined;
  const staticMarginVerdict = aero ? staticMarginVerdictFor(aero.stability.staticMarginPct, aero.validity.lift) : undefined;
  const tailVolumeVerdict = aero ? tailVolumeVerdictFor(aero.stability.tailVolumeCoefficient, aero.validity.tailVolume) : undefined;
  const finVolumeVerdict = aero ? finVolumeVerdictFor(aero.stability.finVolumeCoefficient, aero.validity.finVolume) : undefined;
  const rollVerdict = aero ? rollVerdictFor(aero.stability.rollStabilityIndex, aero.validity.lift) : undefined;
  const diskLoadingVerdict = aero ? diskLoadingVerdictFor(aero.propulsion.rotorDiskLoadingNpm2, aero.validity.rotor) : undefined;
  const speedSweep = aero?.validity.lift || aero?.validity.drag ? buildSpeedSweep(aero, project) : undefined;

  if (!aero || !analysis) {
    return (
      <main className="compute-dashboard">
        <section className="compute-panel compute-empty">
          <h2>Aero</h2>
          <p>Draw the aircraft in Sketch to get live first-pass aerodynamic numbers here.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="compute-dashboard">
      <section className="compute-panel compute-hero">
        <div>
          <h2>Sketch Aero</h2>
          <p>Live first-pass figures from the actual drawn profiles, mirrors, masses, and cruise speed.</p>
        </div>
        <div className="compute-hero-metrics">
          <MetricTile label="CL cruise" value={formatNumber(aero.aerodynamics.liftCoefficient, 2, aero.validity.lift)} />
          <MetricTile label="CD estimate" value={formatNumber(aero.aerodynamics.dragCoefficient, 3, aero.validity.drag)} />
          <MetricTile label="L/D" value={formatNumber(aero.aerodynamics.liftToDrag, 1, aero.validity.lift)} />
          <MetricTile label="Tail volume" value={formatNumber(aero.stability.tailVolumeCoefficient, 2, aero.validity.tailVolume)} />
        </div>
      </section>

      <ComputeGroup icon={<Wind size={17} />} title="Aerodynamics">
        <Metric label="Cruise speed" value={`${aero.aerodynamics.cruiseSpeedKt.toFixed(1)} kt`} />
        <Metric label="Dynamic pressure" value={`${aero.aerodynamics.dynamicPressurePa.toFixed(0)} Pa`} />
        <Metric
          label="CL required"
          note={clVerdict?.text}
          noteTone={clVerdict?.tone}
          value={formatNumber(aero.aerodynamics.liftCoefficient, 3, aero.validity.lift)}
          verification={machClVerification}
        />
        <Metric label="CD induced" value={formatNumber(aero.aerodynamics.inducedDragCoefficient, 3, aero.validity.lift)} />
        <Metric label="CD parasite" value={formatNumber(aero.aerodynamics.parasiteDragCoefficient, 3, aero.validity.drag)} />
        <Metric
          label="CD total"
          note={cdVerdict?.text}
          noteTone={cdVerdict?.tone}
          value={formatNumber(aero.aerodynamics.dragCoefficient, 3, aero.validity.drag)}
          verification={machCdVerification}
        />
        <Metric label="Drag reference area" value={formatWithUnit(aero.geometry.dragReferenceAreaM2, 3, "m2", aero.validity.drag)} />
        <Metric label="Drag" value={formatWithUnit(aero.aerodynamics.dragN, 1, "N", aero.validity.drag)} />
        <Metric label="Cruise power" value={formatPower(aero.aerodynamics.cruisePowerW, aero.validity.drag)} />
        <Metric
          label="L/D"
          note={ldVerdict?.text}
          noteTone={ldVerdict?.tone}
          value={formatNumber(aero.aerodynamics.liftToDrag, 1, aero.validity.lift)}
          verification={machLdVerification}
        />
        <Metric
          label="Stall speed"
          note={aero.lex.active ? `LEX corridor lowers stall by ${aero.lex.stallSpeedReductionPct.toFixed(1)}%` : undefined}
          noteTone={aero.lex.active ? "good" : undefined}
          value={formatLexStallSpeed(aero)}
        />
        <Metric
          label="CLmax"
          note={aero.lex.active ? `vortex over ${aero.lex.influencedAreaM2.toFixed(3)} m2` : undefined}
          noteTone={aero.lex.active ? "good" : undefined}
          value={formatLexClMax(aero)}
        />
      </ComputeGroup>

      <ComputeGroup icon={<Gauge size={17} />} title="Geometry">
        <Metric label="Wing area" value={formatWithUnit(aero.geometry.wingAreaM2, 3, "m2", aero.validity.lift)} />
        <Metric label="Projected span" value={formatWithUnit(aero.geometry.wingSpanM, 2, "m", aero.validity.lift)} />
        <Metric label="True span" value={formatWithUnit(aero.geometry.wingTrueSpanM, 2, "m", aero.validity.lift)} />
        <Metric label="Dihedral" value={formatWithUnit(aero.geometry.averageDihedralDeg, 1, "deg", aero.validity.lift)} />
        <Metric label="Mean chord" value={formatWithUnit(aero.geometry.meanChordM, 3, "m", aero.validity.lift)} />
        <Metric label="Aspect ratio" value={formatNumber(aero.geometry.aspectRatio, 2, aero.validity.lift)} />
        <Metric label="Tailplane area" value={formatWithUnit(aero.geometry.tailplaneAreaM2, 3, "m2", aero.validity.tailVolume)} />
        <Metric label="Tail arm" value={formatWithUnit(aero.geometry.tailplaneArmM, 2, "m", aero.validity.tailVolume)} />
        <Metric label="Fin area" value={formatWithUnit(aero.geometry.finAreaM2, 3, "m2", aero.validity.finVolume)} />
        <Metric label="Fin arm" value={formatWithUnit(aero.geometry.finArmM, 2, "m", aero.validity.finVolume)} />
        <Metric label="LEX area" value={formatWithUnit(aero.geometry.lexAreaM2, 3, "m2", aero.lex.areaM2 > 0)} />
        <Metric label="LEX influenced area" value={formatWithUnit(aero.lex.influencedAreaM2, 3, "m2", aero.lex.influencedAreaM2 > 0)} />
        <Metric label="LEX influenced wing" value={formatWithUnit(aero.lex.influencedWingAreaM2, 3, "m2", aero.lex.influencedWingAreaM2 > 0)} />
        <Metric label="LEX influenced body" value={formatWithUnit(aero.lex.influencedBodyAreaM2, 3, "m2", aero.lex.influencedBodyAreaM2 > 0)} />
        <Metric label="LEX vortex strength" value={aero.lex.active ? aero.lex.vortexStrength.toFixed(2) : "--"} />
      </ComputeGroup>

      <ComputeGroup icon={<Activity size={17} />} title="Stability & Mass">
        <Metric label="Mass" value={`${aero.mass.totalMassKg.toFixed(2)} kg`} />
        <Metric label="Wing loading" value={formatWithUnit(aero.mass.wingLoadingKgM2, 1, "kg/m2", aero.validity.lift)} />
        <Metric label="CoM X" value={`${aero.stability.centerOfMassY.toFixed(3)} m`} />
        <Metric
          label="CoP X"
          value={formatWithUnit(aero.stability.centerOfPressureY, 3, "m", aero.validity.lift)}
          verification={typeof machAcCadexX === "number" ? `MachUpX AC X: ${machAcCadexX.toFixed(3)} m` : undefined}
        />
        <Metric
          label="Static margin"
          note={staticMarginVerdict?.text}
          noteTone={staticMarginVerdict?.tone}
          value={formatWithUnit(aero.stability.staticMarginPct, 1, "%", aero.validity.lift)}
          verification={typeof machStaticMarginCadexPct === "number" ? `MachUpX verified: ${machStaticMarginCadexPct.toFixed(1)} %` : undefined}
        />
        <Metric label="Pitch stability" note={staticMarginVerdict?.text} noteTone={staticMarginVerdict?.tone} value={formatWithUnit(aero.stability.staticMarginPct, 1, "% SM", aero.validity.lift)} />
        <Metric label="Roll stability" note={rollVerdict?.text} noteTone={rollVerdict?.tone} value={aero.validity.lift ? aero.stability.rollStabilityLabel : "--"} />
        <Metric
          label="Dihedral effect"
          note={rollVerdict?.text}
          noteTone={rollVerdict?.tone}
          value={formatNumber(aero.stability.rollStabilityIndex, 2, aero.validity.lift)}
        />
        <Metric label="Yaw stability" note={finVolumeVerdict?.text} noteTone={finVolumeVerdict?.tone} value={formatNumber(aero.stability.finVolumeCoefficient, 3, aero.validity.finVolume)} />
        <Metric label="Horizontal tail volume" note={tailVolumeVerdict?.text} noteTone={tailVolumeVerdict?.tone} value={formatNumber(aero.stability.tailVolumeCoefficient, 3, aero.validity.tailVolume)} />
        <Metric label="Vertical fin volume" note={finVolumeVerdict?.text} noteTone={finVolumeVerdict?.tone} value={formatNumber(aero.stability.finVolumeCoefficient, 3, aero.validity.finVolume)} />
      </ComputeGroup>

      <ComputeGroup icon={<Calculator size={17} />} title="Rotors & Inertia">
        <Metric label="Rotors" value={`${aero.propulsion.rotorCount}`} />
        <Metric label="Rotor disk area" value={formatWithUnit(aero.geometry.rotorDiskAreaM2, 3, "m2", aero.validity.rotor)} />
        <Metric label="Disk loading" note={diskLoadingVerdict?.text} noteTone={diskLoadingVerdict?.tone} value={formatWithUnit(aero.propulsion.rotorDiskLoadingNpm2, 0, "N/m2", aero.validity.rotor)} />
        <Metric label="Hover thrust / rotor" value={formatWithUnit(aero.propulsion.hoverThrustPerRotorN, 1, "N", aero.validity.rotor)} />
        <Metric label="Hover power" value={formatPower(aero.propulsion.hoverPowerTotalW, aero.validity.rotor)} />
        <Metric label="Roll inertia" value={`${aero.inertia.rollKgM2.toFixed(3)} kg m2`} />
        <Metric label="Pitch inertia" value={`${aero.inertia.pitchKgM2.toFixed(3)} kg m2`} />
        <Metric label="Yaw inertia" value={`${aero.inertia.yawKgM2.toFixed(3)} kg m2`} />
      </ComputeGroup>

      <section className="compute-panel compute-wide">
        <PanelHeading icon={<AlertTriangle size={17} />} title="Checks" />
        <div className="compute-warnings">
          {aero.warnings.length ? aero.warnings.map((warning) => <span key={warning}>{warning}</span>) : <span>No major first-pass warnings.</span>}
        </div>
      </section>

      {hasMachUpXSurface ? (
        <section className="compute-panel compute-wide compute-machupx-bottom">
          <PanelHeading icon={<Gauge size={17} />} title="MachUpX Solver" />
          {machResult ? (
            <div className="compute-machupx-grid">
              <Metric label="MachUpX alpha" value={formatOptionalWithUnit(machResult.alphaDeg, 1, "deg")} />
              <Metric label="MachUpX CL" value={formatOptionalNumber(machResult.CL, 3)} />
              <Metric label="MachUpX lifting CD" value={formatOptionalNumber(machResult.CD, 3)} />
              <Metric label="MachUpX L/D" value={formatOptionalNumber(machResult.LD, 1)} />
              <Metric label="Aero center X" value={formatOptionalWithUnit(machAcCadexX, 3, "m")} />
              <Metric label="Aero center Z" value={formatArrayValue(machAc?.aero_center, 2, 3, "m")} />
              <Metric label="Cm at AC" value={formatOptionalNumber(machAc?.Cm_ac, 3)} />
              <Metric label="CL alpha" value={formatOptionalNumber(machStability?.["CL,a"], 2)} />
              <Metric label="Pitch stability Cm alpha" value={formatOptionalNumber(machStability?.["Cm,a"], 2)} />
              <Metric label="Roll stability Cl beta" value={formatOptionalNumber(machStability?.["Cl_w,b"] ?? machStability?.["Cl,b"], 3)} />
              <Metric label="Yaw stability Cn beta" value={formatOptionalNumber(machStability?.["Cn_w,b"] ?? machStability?.["Cn,b"], 3)} />
              <Metric label="MachUpX static margin" value={formatOptionalWithUnit(machStaticMarginCadexPct, 1, "%")} />
              <Metric label="Roll damping" value={formatOptionalNumber(machDamping?.["Cl,pbar"], 3)} />
              <Metric label="Pitch damping" value={formatOptionalNumber(machDamping?.["Cm,qbar"], 2)} />
              <Metric label="Yaw damping" value={formatOptionalNumber(machDamping?.["Cn,rbar"], 3)} />
              <Metric label="Max section CL" value={formatOptionalNumber(machSpanwise?.maxSectionCL, 2)} />
              <Metric label="Max Reynolds" value={formatOptionalNumber(machSpanwise?.maxRe, 0)} />
              <Metric label="Solved surfaces" value={machSpanwise?.surfaceCount !== undefined ? String(machSpanwise.surfaceCount) : "--"} />
              <Metric label="Pitch trim" value={machTrim?.ok ? "available" : "no elevator control"} />
            </div>
          ) : (
            <div className="compute-machupx-grid">
              <Metric label="MachUpX status" note={machAttempt?.message ?? machUpX?.message} noteTone={machAttempt ? "bad" : "caution"} value={machAttempt ? "out of range" : "running"} />
              <Metric label="Target CL" value={formatOptionalNumber(machUpX?.targetCL ?? machAttempt?.targetCL, 3)} />
              <Metric label="Alpha low" value={formatOptionalWithUnit(machAttempt?.low?.alphaDeg, 1, "deg")} />
              <Metric label="CL low" value={formatOptionalNumber(machAttempt?.low?.CL, 3)} />
              <Metric label="Alpha high" value={formatOptionalWithUnit(machAttempt?.high?.alphaDeg, 1, "deg")} />
              <Metric label="CL high" value={formatOptionalNumber(machAttempt?.high?.CL, 3)} />
              <Metric label="Alpha zero" value={formatOptionalWithUnit(machAttempt?.sample?.alphaDeg, 1, "deg")} />
              <Metric label="CL at zero alpha" value={formatOptionalNumber(machAttempt?.sample?.CL, 3)} />
            </div>
          )}
        </section>
      ) : null}

      {speedSweep ? <SpeedSweepPanel sweep={speedSweep} /> : null}
    </main>
  );
}

type SpeedSweepPoint = {
  cd: number;
  cl: number;
  dragN: number;
  enduranceMin: number;
  inducedCd: number;
  inducedDragPct: number;
  liftToDrag: number;
  powerW: number;
  parasiteCd: number;
  rangeKm: number;
  speedKt: number;
  stallMargin: number;
};

type SpeedSweep = {
  availableEnergyWh: number;
  bestEnduranceSpeedKt: number;
  bestEfficiencySpeedKt: number;
  bestRangeSpeedKt: number;
  lowestCdSpeedKt: number;
  cruiseSpeedKt: number;
  energySource: "Actual usable" | "Sizing usable";
  minimumFlyableSpeedKt: number;
  points: SpeedSweepPoint[];
  stallSpeedKt: number;
};

function SpeedSweepPanel({ sweep }: { sweep: SpeedSweep }) {
  return (
    <section className="compute-panel compute-wide compute-graphs">
      <PanelHeading icon={<Activity size={17} />} title="Speed Curves" />
      <div className="compute-graph-grid">
        <div className="compute-speed-summary">
          <Metric label="Best endurance" value={`${sweep.bestEnduranceSpeedKt.toFixed(1)} kt`} />
          <Metric label="Best range" value={`${sweep.bestRangeSpeedKt.toFixed(1)} kt`} />
          <Metric label="Cruise target" value={`${sweep.cruiseSpeedKt.toFixed(1)} kt`} />
          <Metric label="Stall estimate" value={`${sweep.stallSpeedKt.toFixed(1)} kt`} />
          <Metric label="Min fly speed" value={`${sweep.minimumFlyableSpeedKt.toFixed(1)} kt`} />
          <Metric label={sweep.energySource} value={`${sweep.availableEnergyWh.toFixed(0)} Wh`} />
        </div>
        <CurveChart
          color="#7dd3fc"
          cruiseSpeedKt={sweep.cruiseSpeedKt}
          formatValue={(value) => value.toFixed(2)}
          label="CL required"
          points={sweep.points.map((point) => ({ x: point.speedKt, y: point.cl }))}
          stallSpeedKt={sweep.stallSpeedKt}
        />
        <DragPowerOverlayChart
          bestEnduranceSpeedKt={sweep.bestEnduranceSpeedKt}
          bestRangeSpeedKt={sweep.bestRangeSpeedKt}
          cruiseSpeedKt={sweep.cruiseSpeedKt}
          points={sweep.points}
          stallSpeedKt={sweep.stallSpeedKt}
        />
        <CurveChart
          color="#a78bfa"
          cruiseSpeedKt={sweep.cruiseSpeedKt}
          formatValue={formatEnduranceMinutes}
          label="Endurance vs speed"
          points={sweep.points.map((point) => ({ x: point.speedKt, y: point.enduranceMin }))}
          stallSpeedKt={sweep.stallSpeedKt}
          targetSpeedKt={sweep.bestEnduranceSpeedKt}
          targetLabel="best"
          valueSpeedKt={sweep.bestEnduranceSpeedKt}
        />
        <CurveChart
          color="#fb7185"
          cruiseSpeedKt={sweep.cruiseSpeedKt}
          formatValue={formatRangeKm}
          label="Range vs speed"
          points={sweep.points.map((point) => ({ x: point.speedKt, y: point.rangeKm }))}
          stallSpeedKt={sweep.stallSpeedKt}
          targetSpeedKt={sweep.bestRangeSpeedKt}
          targetLabel="best"
          valueSpeedKt={sweep.bestRangeSpeedKt}
        />
        <CurveChart
          color="#facc15"
          cruiseSpeedKt={sweep.cruiseSpeedKt}
          formatValue={formatLiftToDrag}
          label="L/D vs speed"
          points={sweep.points.map((point) => ({ x: point.speedKt, y: point.liftToDrag }))}
          stallSpeedKt={sweep.stallSpeedKt}
          targetSpeedKt={sweep.bestEfficiencySpeedKt}
          targetLabel="peak"
          valueSpeedKt={sweep.bestEfficiencySpeedKt}
        />
        <CurveChart
          color="#38bdf8"
          cruiseSpeedKt={sweep.cruiseSpeedKt}
          formatValue={formatRatio}
          label="Stall margin"
          points={sweep.points.map((point) => ({ x: point.speedKt, y: point.stallMargin }))}
          stallSpeedKt={sweep.stallSpeedKt}
        />
        <CurveChart
          color="#f97316"
          cruiseSpeedKt={sweep.cruiseSpeedKt}
          formatValue={formatCoefficient}
          label="CD total vs speed"
          points={sweep.points.map((point) => ({ x: point.speedKt, y: point.cd }))}
          stallSpeedKt={sweep.stallSpeedKt}
          targetSpeedKt={sweep.lowestCdSpeedKt}
          targetLabel="min"
          valueSpeedKt={sweep.lowestCdSpeedKt}
        />
        <CurveChart
          color="#22c55e"
          cruiseSpeedKt={sweep.cruiseSpeedKt}
          formatValue={formatPercent}
          label="Induced drag share"
          points={sweep.points.map((point) => ({ x: point.speedKt, y: point.inducedDragPct }))}
          stallSpeedKt={sweep.stallSpeedKt}
        />
      </div>
    </section>
  );
}

function DragPowerOverlayChart({
  bestEnduranceSpeedKt,
  bestRangeSpeedKt,
  cruiseSpeedKt,
  points,
  stallSpeedKt,
}: {
  bestEnduranceSpeedKt: number;
  bestRangeSpeedKt: number;
  cruiseSpeedKt: number;
  points: SpeedSweepPoint[];
  stallSpeedKt: number;
}) {
  const width = 560;
  const height = 210;
  const pad = { bottom: 32, left: 42, right: 24, top: 18 };
  const xs = points.map((point) => point.speedKt);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minDrag = Math.min(...points.map((point) => point.dragN));
  const maxDrag = Math.max(...points.map((point) => point.dragN));
  const minPower = Math.min(...points.map((point) => point.powerW));
  const maxPower = Math.max(...points.map((point) => point.powerW));
  const normalize = (value: number, min: number, max: number) => (value - min) / Math.max(max - min, 1);
  const xFor = (value: number) => pad.left + ((value - minX) / Math.max(maxX - minX, 1)) * (width - pad.left - pad.right);
  const yFor = (value: number) => height - pad.bottom - value * (height - pad.top - pad.bottom);
  const clampSpeed = (value: number) => Math.min(Math.max(value, minX), maxX);
  const pathFor = (values: number[]) =>
    values.map((value, index) => `${index === 0 ? "M" : "L"} ${xFor(points[index].speedKt).toFixed(2)} ${yFor(value).toFixed(2)}`).join(" ");
  const dragPath = pathFor(points.map((point) => normalize(point.dragN, minDrag, maxDrag)));
  const powerPath = pathFor(points.map((point) => normalize(point.powerW, minPower, maxPower)));
  const rangePoint = nearestPoint(points.map((point) => ({ x: point.speedKt, y: point.dragN })), bestRangeSpeedKt);
  const endurancePoint = nearestPoint(points.map((point) => ({ x: point.speedKt, y: point.powerW })), bestEnduranceSpeedKt);
  const cruisePoint = nearestPoint(points.map((point) => ({ x: point.speedKt, y: point.powerW })), cruiseSpeedKt);
  const stallX = xFor(clampSpeed(stallSpeedKt));
  const cruiseX = xFor(clampSpeed(cruiseSpeedKt));
  const rangeX = xFor(clampSpeed(bestRangeSpeedKt));
  const enduranceX = xFor(clampSpeed(bestEnduranceSpeedKt));

  return (
    <div className="compute-curve-card compute-overlay-card">
      <div className="compute-curve-title">
        <span>Drag / power overlay</span>
        <strong>{cruisePoint ? formatPower(cruisePoint.y) : "--"}</strong>
      </div>
      <div className="compute-curve-legend">
        <span className="drag">drag</span>
        <span className="power">power</span>
        <span>range {rangePoint ? `${bestRangeSpeedKt.toFixed(1)} kt, ${rangePoint.y.toFixed(0)} N` : "--"}</span>
        <span>endurance {endurancePoint ? `${bestEnduranceSpeedKt.toFixed(1)} kt, ${formatPower(endurancePoint.y)}` : "--"}</span>
      </div>
      <svg aria-label="Drag and power speed overlay" role="img" viewBox={`0 0 ${width} ${height}`}>
        <line className="compute-curve-gridline" x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} />
        <line className="compute-curve-gridline" x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} />
        <line className="compute-curve-stall" x1={stallX} x2={stallX} y1={pad.top} y2={height - pad.bottom} />
        <line className="compute-curve-cruise" x1={cruiseX} x2={cruiseX} y1={pad.top} y2={height - pad.bottom} />
        <line className="compute-curve-range" x1={rangeX} x2={rangeX} y1={pad.top} y2={height - pad.bottom} />
        <line className="compute-curve-endurance" x1={enduranceX} x2={enduranceX} y1={pad.top} y2={height - pad.bottom} />
        <path className="compute-curve-line compute-curve-drag" d={dragPath} fill="none" />
        <path className="compute-curve-line compute-curve-power" d={powerPath} fill="none" />
        <text className="compute-curve-axis-label" x={pad.left} y={height - 8}>{minX.toFixed(0)} kt</text>
        <text className="compute-curve-axis-label" textAnchor="end" x={width - pad.right} y={height - 8}>{maxX.toFixed(0)} kt</text>
        <text className="compute-curve-axis-label" textAnchor="middle" x={stallX} y={pad.top + 10}>{speedMarkerLabel("stall", stallSpeedKt)}</text>
        <text className="compute-curve-axis-label" textAnchor="middle" x={rangeX} y={pad.top + 24}>{speedMarkerLabel("range", bestRangeSpeedKt)}</text>
        <text className="compute-curve-axis-label" textAnchor="middle" x={enduranceX} y={pad.top + 38}>{speedMarkerLabel("endurance", bestEnduranceSpeedKt)}</text>
        <text className="compute-curve-axis-label" textAnchor="middle" x={cruiseX} y={pad.top + 52}>{speedMarkerLabel("cruise", cruiseSpeedKt)}</text>
      </svg>
    </div>
  );
}

function CurveChart({
  color,
  cruiseSpeedKt,
  formatValue,
  label,
  points,
  stallSpeedKt,
  targetLabel,
  targetSpeedKt,
  valueSpeedKt,
}: {
  color: string;
  cruiseSpeedKt: number;
  formatValue: (value: number) => string;
  label: string;
  points: Array<{ x: number; y: number }>;
  stallSpeedKt: number;
  targetLabel?: string;
  targetSpeedKt?: number;
  valueSpeedKt?: number;
}) {
  const width = 360;
  const height = 170;
  const pad = { bottom: 28, left: 42, right: 18, top: 16 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y).filter((value) => Number.isFinite(value));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(...ys, 1);
  const xFor = (value: number) => pad.left + ((value - minX) / Math.max(maxX - minX, 1)) * (width - pad.left - pad.right);
  const yFor = (value: number) => height - pad.bottom - ((value - minY) / Math.max(maxY - minY, 1)) * (height - pad.top - pad.bottom);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(point.x).toFixed(2)} ${yFor(point.y).toFixed(2)}`).join(" ");
  const valuePoint = nearestPoint(points, valueSpeedKt ?? cruiseSpeedKt);
  const stallX = xFor(Math.min(Math.max(stallSpeedKt, minX), maxX));
  const cruiseX = xFor(Math.min(Math.max(cruiseSpeedKt, minX), maxX));
  const targetPoint = targetSpeedKt === undefined ? undefined : nearestPoint(points, targetSpeedKt);
  const targetX = targetSpeedKt === undefined ? undefined : xFor(Math.min(Math.max(targetSpeedKt, minX), maxX));
  return (
    <div className="compute-curve-card">
      <div className="compute-curve-title">
        <span>{label}</span>
        <strong>{valuePoint ? formatValue(valuePoint.y) : "--"}</strong>
      </div>
      <svg aria-label={`${label} speed curve`} role="img" viewBox={`0 0 ${width} ${height}`}>
        <line className="compute-curve-gridline" x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} />
        <line className="compute-curve-gridline" x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} />
        <line className="compute-curve-stall" x1={stallX} x2={stallX} y1={pad.top} y2={height - pad.bottom} />
        <line className="compute-curve-cruise" x1={cruiseX} x2={cruiseX} y1={pad.top} y2={height - pad.bottom} />
        {targetX !== undefined ? <line className="compute-curve-best" x1={targetX} x2={targetX} y1={pad.top} y2={height - pad.bottom} /> : null}
        <path className="compute-curve-line" d={path} fill="none" stroke={color} />
        {valuePoint ? <circle className="compute-curve-point" cx={xFor(valuePoint.x)} cy={yFor(valuePoint.y)} r="4" style={{ fill: color }} /> : null}
        {targetPoint ? <circle className="compute-curve-target-point" cx={xFor(targetPoint.x)} cy={yFor(targetPoint.y)} r="4" style={{ fill: color }} /> : null}
        <text className="compute-curve-axis-label" x={pad.left} y={height - 8}>{minX.toFixed(0)} kt</text>
        <text className="compute-curve-axis-label" textAnchor="end" x={width - pad.right} y={height - 8}>{maxX.toFixed(0)} kt</text>
        <text className="compute-curve-axis-label" textAnchor="middle" x={stallX} y={pad.top + 10}>{speedMarkerLabel("stall", stallSpeedKt)}</text>
        <text className="compute-curve-axis-label" textAnchor="middle" x={cruiseX} y={pad.top + 24}>{speedMarkerLabel("cruise", cruiseSpeedKt)}</text>
        {targetX !== undefined ? <text className="compute-curve-axis-label" textAnchor="middle" x={targetX} y={pad.top + 38}>{speedMarkerLabel(targetLabel ?? "best", targetSpeedKt ?? 0)}</text> : null}
      </svg>
    </div>
  );
}

function buildSpeedSweep(aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>, project: SizingProject): SpeedSweep {
  const cruiseSpeedMS = Math.max(aero.aerodynamics.cruiseSpeedMS, 1);
  const cruiseSpeedKt = cruiseSpeedMS / 0.514444;
  const stallSpeedKt = aero.validity.lift && aero.aerodynamics.stallSpeedMS > 0 ? aero.aerodynamics.stallSpeedMS / 0.514444 : Math.max(cruiseSpeedKt * 0.55, 8);
  const minimumFlyableSpeedKt = stallSpeedKt * minimumSpeedMarginAboveStall;
  const minSpeedKt = Math.max(6, Math.min(stallSpeedKt * 1.03, cruiseSpeedKt * 0.55));
  const maxSpeedKt = Math.max(cruiseSpeedKt * 1.9, minimumFlyableSpeedKt * 2.2, stallSpeedKt * 2.4, minSpeedKt + 18);
  const weightN = Math.max(aero.mass.totalMassKg * 9.80665, 0.1);
  const wingAreaM2 = Math.max(aero.geometry.wingAreaM2, 0.001);
  const aspectRatio = Math.max(aero.geometry.aspectRatio, 0.1);
  const dihedralLiftFactor = Math.pow(Math.cos((aero.geometry.averageDihedralDeg * Math.PI) / 180), 2);
  const inducedFactor = 1 / (Math.PI * aero.assumptions.oswaldEfficiency * Math.max(aspectRatio * dihedralLiftFactor, 0.001));
  const parasiteCd = Math.max(aero.assumptions.parasiteCd, 0.001);
  const propulsiveEfficiency = Math.max(aero.assumptions.propulsiveEfficiency, 0.05);
  const energy = speedSweepEnergy(project, aero);
  const sampleSpeedsKt = uniqueSortedNumbers([
    ...Array.from({ length: 61 }, (_, index) => minSpeedKt + (maxSpeedKt - minSpeedKt) * (index / 60)),
    cruiseSpeedKt,
    minimumFlyableSpeedKt,
    stallSpeedKt,
  ]).filter((speedKt) => speedKt >= minSpeedKt && speedKt <= maxSpeedKt);
  const points: SpeedSweepPoint[] = sampleSpeedsKt.map((speedKt) => {
    const speedMS = speedKt * 0.514444;
    const dynamicPressurePa = 0.5 * aero.assumptions.rhoKgM3 * speedMS * speedMS;
    const cl = weightN / Math.max(dynamicPressurePa * wingAreaM2, 0.001);
    const inducedCd = inducedFactor * cl * cl;
    const cd = parasiteCd + inducedCd;
    const dragN = dynamicPressurePa * wingAreaM2 * cd;
    const powerW = (dragN * speedMS) / propulsiveEfficiency;
    const enduranceH = energy.availableEnergyWh / Math.max(powerW, 1);
    const enduranceMin = enduranceH * 60;
    const rangeKm = speedKt * 1.852 * enduranceH;
    const liftToDrag = cl / Math.max(cd, 0.001);
    const stallMargin = aero.aerodynamics.maxLiftCoefficientWithLex / Math.max(cl, 0.001);
    const inducedDragPct = (inducedCd / Math.max(cd, 0.001)) * 100;
    return { cd, cl, dragN, enduranceMin, inducedCd, inducedDragPct, liftToDrag, parasiteCd, powerW, rangeKm, speedKt, stallMargin };
  });
  const flyablePoints = points.filter((point) => point.speedKt >= minimumFlyableSpeedKt);
  const bestRange = bestPoint(flyablePoints, (best, point) => point.rangeKm > best.rangeKm) ?? points[points.length - 1];
  const bestEndurance = bestPoint(flyablePoints, (best, point) => point.enduranceMin > best.enduranceMin) ?? points[points.length - 1];
  const bestEfficiency = points.reduce((best, point) => (point.liftToDrag > best.liftToDrag ? point : best), points[0]);
  const lowestCd = points.reduce((best, point) => (point.cd < best.cd ? point : best), points[0]);
  const bestRangeSpeedKt = bestRange?.speedKt ?? cruiseSpeedKt;
  const bestEnduranceSpeedKt = bestEndurance?.speedKt ?? cruiseSpeedKt;
  const bestEfficiencySpeedKt = bestEfficiency?.speedKt ?? cruiseSpeedKt;
  const lowestCdSpeedKt = lowestCd?.speedKt ?? cruiseSpeedKt;
  return {
    availableEnergyWh: energy.availableEnergyWh,
    bestEnduranceSpeedKt,
    bestEfficiencySpeedKt,
    bestRangeSpeedKt,
    cruiseSpeedKt,
    energySource: energy.source,
    lowestCdSpeedKt,
    minimumFlyableSpeedKt,
    points,
    stallSpeedKt,
  };
}

const minimumSpeedMarginAboveStall = 1.2;

function bestPoint<T>(points: T[], better: (best: T, point: T) => boolean) {
  if (!points.length) return undefined;
  return points.reduce((best, point) => (better(best, point) ? point : best), points[0]);
}

function uniqueSortedNumbers(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]) > 1e-6);
}

function speedSweepEnergy(project: SizingProject, aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>) {
  const reserveFactor = 1 + Math.max(project.mission.reservePct, 0) / 100;
  const batteryMassKg = project.shapes
    .filter((shape) => shape.role === "part" && shape.partType === "battery")
    .reduce((total, shape) => total + batteryMassEstimate(shape), 0);
  if (batteryMassKg > 0) {
    return {
      availableEnergyWh: (batteryMassKg * Math.max(project.mission.batteryEnergyDensityWhKg, 1)) / reserveFactor,
      source: "Actual usable" as const,
    };
  }
  const cruiseEnergyWh = (Math.max(aero.aerodynamics.cruisePowerW, 1) * Math.max(project.mission.enduranceMin, 1)) / 60;
  return {
    availableEnergyWh: cruiseEnergyWh,
    source: "Sizing usable" as const,
  };
}

function nearestPoint(points: Array<{ x: number; y: number }>, x: number) {
  return points.reduce<{ x: number; y: number } | undefined>((best, point) => {
    if (!best) return point;
    return Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best;
  }, undefined);
}

function ComputeGroup({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <section className="compute-panel compute-group">
      <PanelHeading icon={icon} title={title} />
      <div>{children}</div>
    </section>
  );
}

function PanelHeading({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="compute-panel-heading">
      {icon}
      <h3>{title}</h3>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="compute-metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatNumber(value: number, decimals: number, valid = true) {
  return valid && Number.isFinite(value) ? value.toFixed(decimals) : "--";
}

function formatWithUnit(value: number, decimals: number, unit: string, valid = true) {
  return valid && Number.isFinite(value) ? `${value.toFixed(decimals)} ${unit}` : "--";
}

function formatLexStallSpeed(aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>) {
  if (!aero.validity.lift) return "--";
  const cleanKt = aero.aerodynamics.stallSpeedCleanMS / 0.514444;
  const lexKt = aero.aerodynamics.stallSpeedMS / 0.514444;
  if (!aero.lex.active) return `${lexKt.toFixed(1)} kt`;
  return `${cleanKt.toFixed(1)} kt clean / ${lexKt.toFixed(1)} kt LEX`;
}

function formatLexClMax(aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>) {
  if (!aero.validity.lift) return "--";
  if (!aero.lex.active) return aero.aerodynamics.maxLiftCoefficientClean.toFixed(2);
  return `${aero.aerodynamics.maxLiftCoefficientClean.toFixed(2)} clean / ${aero.aerodynamics.maxLiftCoefficientWithLex.toFixed(2)} LEX`;
}

function formatOptionalNumber(value: number | null | undefined, decimals: number) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(decimals) : "--";
}

function formatArrayValue(values: number[] | undefined, index: number, decimals: number, unit: string) {
  const value = values?.[index];
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(decimals)} ${unit}` : "--";
}

function formatOptionalWithUnit(value: number | undefined, decimals: number, unit: string) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(decimals)} ${unit}` : "--";
}

function cruiseClVerdict(value: number, valid: boolean) {
  if (!valid || !Number.isFinite(value)) return undefined;
  if (value < 0.2) return { text: "lightly loaded", tone: "caution" as const };
  if (value <= 0.65) return { text: "good cruise loading", tone: "good" as const };
  if (value <= 0.85) return { text: "high cruise loading", tone: "caution" as const };
  return { text: "too close to stall margin", tone: "bad" as const };
}

function cdVerdictFor(value: number, valid: boolean) {
  if (!valid || !Number.isFinite(value)) return undefined;
  if (value <= 0.07) return { text: "clean", tone: "good" as const };
  if (value <= 0.12) return { text: "draggy but plausible", tone: "caution" as const };
  return { text: "excessive drag", tone: "bad" as const };
}

function liftToDragVerdict(value: number, valid: boolean) {
  if (!valid || !Number.isFinite(value)) return undefined;
  if (value >= 9) return { text: "efficient", tone: "good" as const };
  if (value >= 5) return { text: "usable", tone: "caution" as const };
  return { text: "poor cruise efficiency", tone: "bad" as const };
}

function staticMarginVerdictFor(value: number, valid: boolean) {
  if (!valid || !Number.isFinite(value)) return undefined;
  if (value < 0) return { text: "unstable", tone: "bad" as const };
  if (value < 5) return { text: "marginal", tone: "caution" as const };
  if (value <= 20) return { text: "good", tone: "good" as const };
  if (value <= 45) return { text: "stable but nose-heavy", tone: "caution" as const };
  return { text: "excessively stable", tone: "bad" as const };
}

function tailVolumeVerdictFor(value: number, valid: boolean) {
  if (!valid || !Number.isFinite(value)) return undefined;
  if (value < 0.25) return { text: "weak pitch authority", tone: "bad" as const };
  if (value < 0.45) return { text: "light tail volume", tone: "caution" as const };
  if (value <= 0.9) return { text: "good", tone: "good" as const };
  return { text: "large tail penalty", tone: "caution" as const };
}

function finVolumeVerdictFor(value: number, valid: boolean) {
  if (!valid || !Number.isFinite(value)) return undefined;
  if (value < 0.025) return { text: "weak yaw stability", tone: "bad" as const };
  if (value < 0.045) return { text: "light yaw margin", tone: "caution" as const };
  if (value <= 0.09) return { text: "good", tone: "good" as const };
  return { text: "large fin penalty", tone: "caution" as const };
}

function rollVerdictFor(value: number, valid: boolean) {
  if (!valid || !Number.isFinite(value)) return undefined;
  if (value < -1.5) return { text: "roll destabilising", tone: "bad" as const };
  if (value < 0.5) return { text: "nearly neutral", tone: "caution" as const };
  if (value < 3.5) return { text: "mild", tone: "good" as const };
  if (value < 6) return { text: "stable", tone: "good" as const };
  return { text: "excessive self-righting", tone: "caution" as const };
}

function diskLoadingVerdictFor(value: number, valid: boolean) {
  if (!valid || !Number.isFinite(value)) return undefined;
  if (value <= 90) return { text: "hover efficient", tone: "good" as const };
  if (value <= 160) return { text: "moderate", tone: "caution" as const };
  return { text: "hover power expensive", tone: "bad" as const };
}

function formatPower(valueW: number, valid = true) {
  if (!valid || !Number.isFinite(valueW)) return "--";
  if (valueW < 1000) return `${valueW.toFixed(0)} W`;
  return `${(valueW / 1000).toFixed(2)} kW`;
}

function speedMarkerLabel(label: string, speedKt: number) {
  return `${label} ${speedKt.toFixed(0)} kt`;
}

function formatEnduranceMinutes(valueMin: number) {
  if (!Number.isFinite(valueMin)) return "--";
  if (valueMin < 1 / 60) return "<1 sec";
  if (valueMin < 1) return `${(valueMin * 60).toFixed(0)} sec`;
  if (valueMin < 10) return `${valueMin.toFixed(1)} min`;
  return `${valueMin.toFixed(0)} min`;
}

function formatRangeKm(valueKm: number) {
  if (!Number.isFinite(valueKm)) return "--";
  if (valueKm < 10) return `${valueKm.toFixed(2)} km`;
  return `${valueKm.toFixed(1)} km`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(0)}%`;
}

function formatLiftToDrag(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (value < 1) return value.toFixed(2);
  return value.toFixed(1);
}

function formatRatio(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (value > 0 && value < 0.1) return "<0.1x";
  if (value < 10) return `${value.toFixed(1)}x`;
  return `${value.toFixed(0)}x`;
}

function formatCoefficient(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 1000) return value.toExponential(1);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(3);
}
