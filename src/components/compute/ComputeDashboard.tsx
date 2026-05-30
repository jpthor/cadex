import { invoke } from "@tauri-apps/api/core";
import { Activity, AlertTriangle, Calculator, Gauge, Wind } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { batteryMassEstimate, computeSketchAerodynamics, computeSizingAnalysis } from "../../sizing";
import type { SizingProject } from "../../sizing";
import { usableEnergyFromInstalledWh } from "../../sizing/energy";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import { Metric } from "../ui/Metric";
import { computeMetricInfo } from "./computeMetricInfo";

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

function computeInfoFor(label: string) {
  const normalized = label.replace(/\s+\([^)]*\)/g, "");
  return computeMetricInfo[label] ?? computeMetricInfo[normalized];
}

function ComputeMetric({ info, label, ...rest }: ComponentProps<typeof Metric>) {
  return <Metric {...rest} info={info ?? computeInfoFor(label)} label={label} />;
}

function isWingLikeKind(kind: string | undefined) {
  return (kind ?? "wing") === "wing" || kind === "wingevon";
}

export function ComputeDashboard({ project, projectName }: { project: SizingProject; projectName: string }) {
  const analysis = useMemo(() => (project.shapes.length ? computeSizingAnalysis(project) : undefined), [project]);
  const aero = useMemo(() => (project.shapes.length ? computeSketchAerodynamics(project) : undefined), [project]);
  const [machUpX, setMachUpX] = useState<MachUpXReport | undefined>();
  const hasMachUpXSurface = project.shapes.some(
    (shape) => shape.role === "liftingSurface" && isWingLikeKind(shape.liftingSurfaceKind) && shape.points.length >= 3,
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
  const stallAdders = aero ? buildStallMarginAdders(aero) : undefined;

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
          <ComputeMetricTile label="CL cruise" value={formatNumber(aero.aerodynamics.liftCoefficient, 2, aero.validity.lift)} />
          <ComputeMetricTile label="CD estimate" value={formatNumber(aero.aerodynamics.dragCoefficient, 3, aero.validity.drag)} />
          <ComputeMetricTile label="L/D" value={formatNumber(aero.aerodynamics.liftToDrag, 1, aero.validity.lift)} />
          <ComputeMetricTile label="Tail volume" value={formatNumber(aero.stability.tailVolumeCoefficient, 2, aero.validity.tailVolume)} />
        </div>
      </section>

      <ComputeGroup icon={<Wind size={17} />} title="Aerodynamics">
        <ComputeMetric label="Cruise speed" value={`${aero.aerodynamics.cruiseSpeedKt.toFixed(1)} kt`} />
        <ComputeMetric label="Dynamic pressure" value={`${aero.aerodynamics.dynamicPressurePa.toFixed(0)} Pa`} />
        <ComputeMetric
          label="CL required"
          note={clVerdict?.text}
          noteTone={clVerdict?.tone}
          value={formatNumber(aero.aerodynamics.liftCoefficient, 3, aero.validity.lift)}
          verification={machClVerification}
        />
        <ComputeMetric label="CD induced" value={formatNumber(aero.aerodynamics.inducedDragCoefficient, 3, aero.validity.lift)} />
        <ComputeMetric label="CD parasite" value={formatNumber(aero.aerodynamics.parasiteDragCoefficient, 3, aero.validity.drag)} />
        <ComputeMetric
          label="CD total"
          note={cdVerdict?.text}
          noteTone={cdVerdict?.tone}
          value={formatNumber(aero.aerodynamics.dragCoefficient, 3, aero.validity.drag)}
          verification={machCdVerification}
        />
        <ComputeMetric label="Drag reference area" value={formatWithUnit(aero.geometry.dragReferenceAreaM2, 3, "m2", aero.validity.drag)} />
        <ComputeMetric label="Drag" value={formatWithUnit(aero.aerodynamics.dragN, 1, "N", aero.validity.drag)} />
        <ComputeMetric label="Cruise power" value={formatPower(aero.aerodynamics.cruisePowerW, aero.validity.drag)} />
        <ComputeMetric
          label="L/D"
          note={ldVerdict?.text}
          noteTone={ldVerdict?.tone}
          value={formatNumber(aero.aerodynamics.liftToDrag, 1, aero.validity.lift)}
          verification={machLdVerification}
        />
      </ComputeGroup>

      <ComputeGroup icon={<Wind size={17} />} title="LEX & Blown Wing">
        <ComputeMetric
          label="Flight regime"
          note={stallAdders ? `${stallAdders.cleanStallKt.toFixed(1)} kt high AoA, ${stallAdders.appliedStallKt.toFixed(1)} kt full stall` : undefined}
          noteTone={flightRegimeFor(aero).tone}
          value={flightRegimeFor(aero).label}
        />
        <ComputeMetric label="Clean stall speed" value={stallAdders ? `${stallAdders.cleanStallKt.toFixed(1)} kt` : "--"} />
        <ComputeMetric
          label="High-AoA band"
          note="Between clean stall and full stall"
          noteTone={stallAdders && stallAdders.highAoABandKt > 0 ? "good" : undefined}
          value={stallAdders ? `${stallAdders.appliedStallKt.toFixed(1)}-${stallAdders.cleanStallKt.toFixed(1)} kt` : "--"}
        />
        <ComputeMetric
          label="Full stall speed"
          note={stallAdders && stallAdders.totalReductionKt > 0 ? `${stallAdders.totalReductionKt.toFixed(1)} kt slower than clean` : undefined}
          noteTone={stallAdders && stallAdders.totalReductionKt > 0 ? "good" : undefined}
          value={stallAdders ? `${stallAdders.appliedStallKt.toFixed(1)} kt` : "--"}
        />
        <ComputeMetric
          label="Added stall margin"
          note={stallAdders ? `${stallAdders.cleanCruiseMargin.toFixed(2)}x clean / ${stallAdders.appliedCruiseMargin.toFixed(2)}x applied` : undefined}
          noteTone={stallAdders && stallAdders.marginGain > 0 ? "good" : undefined}
          value={stallAdders ? `+${stallAdders.marginGain.toFixed(2)}x` : "--"}
        />
        <ComputeMetric
          label="CLmax"
          note={clMaxNote(aero)}
          noteTone={aero.lex.active || aero.rotorBlownWing.active || aero.wingevon.active ? "good" : undefined}
          value={formatLexClMax(aero)}
        />
        <ComputeMetric label="CLmax for 30 kt" value={formatRequiredClMaxForStall(aero, 30)} />
        <ComputeMetric label="CLmax for 25 kt" value={formatRequiredClMaxForStall(aero, 25)} />
        <ComputeMetric
          label="Stall AoA"
          note={aero.lex.active || aero.rotorBlownWing.active || aero.wingevon.active ? "clean / applied" : undefined}
          noteTone={aero.lex.active || aero.rotorBlownWing.active || aero.wingevon.active ? "good" : undefined}
          value={formatStallAoA(aero)}
        />
        <ComputeMetric
          label="Wingevon stall margin"
          note={aero.wingevon.active ? `${(aero.wingevon.areaRatio * 100).toFixed(0)}% wing area, ${(aero.wingevon.aoaBlendFactor * 100).toFixed(0)}% AoA blend` : "mark an outer wing panel as Wingevon"}
          noteTone={aero.wingevon.active ? "good" : undefined}
          value={stallAdders && aero.wingevon.active ? `${stallAdders.wingevonReductionKt.toFixed(1)} kt / +${aero.wingevon.deltaMaxLiftCoefficient.toFixed(2)} CLmax` : "--"}
        />
        <ComputeMetric label="Wingevon area" value={formatWithUnit(aero.wingevon.areaM2, 3, "m2", aero.wingevon.active)} />
        <ComputeMetric label="Wingevon effective AoA" value={aero.wingevon.active ? `${aero.wingevon.effectiveStallAngleDeg.toFixed(1)} deg` : "--"} />
        <ComputeMetric
          label="LEX stall margin"
          note={aero.lex.active ? `${aero.lex.influencedAreaM2.toFixed(3)} m2 influenced` : "draw LEX lifting surface to enable"}
          noteTone={aero.lex.active ? "good" : undefined}
          value={stallAdders && aero.lex.active ? `${stallAdders.lexReductionKt.toFixed(1)} kt / +${aero.lex.deltaMaxLiftCoefficient.toFixed(2)} CLmax` : "--"}
        />
        <ComputeMetric label="LEX area" value={formatWithUnit(aero.geometry.lexAreaM2, 3, "m2", aero.lex.areaM2 > 0)} />
        <ComputeMetric label="LEX influenced wing" value={formatWithUnit(aero.lex.influencedWingAreaM2, 3, "m2", aero.lex.influencedWingAreaM2 > 0)} />
        <ComputeMetric label="LEX influenced body" value={formatWithUnit(aero.lex.influencedBodyAreaM2, 3, "m2", aero.lex.influencedBodyAreaM2 > 0)} />
        <ComputeMetric label="LEX vortex strength" value={aero.lex.active ? aero.lex.vortexStrength.toFixed(2) : "--"} />
        <ComputeMetric
          label="Blown wing stall margin"
          note={aero.rotorBlownWing.active ? `${(aero.rotorBlownWing.blownAreaRatio * 100).toFixed(0)}% wing coverage` : "needs rotor disks over the wing"}
          noteTone={aero.rotorBlownWing.active ? "good" : undefined}
          value={stallAdders && aero.rotorBlownWing.active ? `${stallAdders.blownReductionKt.toFixed(1)} kt / +${aero.rotorBlownWing.deltaMaxLiftCoefficient.toFixed(2)} CLmax` : "--"}
        />
        <ComputeMetric label="Blown wing area" value={formatWithUnit(aero.rotorBlownWing.blownAreaM2, 3, "m2", aero.rotorBlownWing.active)} />
        <ComputeMetric label="Blown q ratio" value={aero.rotorBlownWing.active ? `${aero.rotorBlownWing.dynamicPressureRatio.toFixed(2)}x` : "--"} />
      </ComputeGroup>

      <ComputeGroup icon={<Gauge size={17} />} title="Geometry">
        <ComputeMetric label="Wing area" value={formatWithUnit(aero.geometry.wingAreaM2, 3, "m2", aero.validity.lift)} />
        <ComputeMetric label="Projected span" value={formatWithUnit(aero.geometry.wingSpanM, 2, "m", aero.validity.lift)} />
        <ComputeMetric label="True span" value={formatWithUnit(aero.geometry.wingTrueSpanM, 2, "m", aero.validity.lift)} />
        <ComputeMetric label="Dihedral" value={formatWithUnit(aero.geometry.averageDihedralDeg, 1, "deg", aero.validity.lift)} />
        <ComputeMetric label="Mean chord" value={formatWithUnit(aero.geometry.meanChordM, 3, "m", aero.validity.lift)} />
        <ComputeMetric label="Aspect ratio" value={formatNumber(aero.geometry.aspectRatio, 2, aero.validity.lift)} />
        <ComputeMetric label="Tailplane area" value={formatWithUnit(aero.geometry.tailplaneAreaM2, 3, "m2", aero.validity.tailVolume)} />
        <ComputeMetric label="Tail arm" value={formatWithUnit(aero.geometry.tailplaneArmM, 2, "m", aero.validity.tailVolume)} />
        <ComputeMetric label="Fin area" value={formatWithUnit(aero.geometry.finAreaM2, 3, "m2", aero.validity.finVolume)} />
        <ComputeMetric label="Fin arm" value={formatWithUnit(aero.geometry.finArmM, 2, "m", aero.validity.finVolume)} />
      </ComputeGroup>

      <ComputeGroup icon={<Activity size={17} />} title="Stability & Mass">
        <ComputeMetric label="Mass" value={`${aero.mass.totalMassKg.toFixed(2)} kg`} />
        <ComputeMetric label="Wing loading" value={formatWithUnit(aero.mass.wingLoadingKgM2, 1, "kg/m2", aero.validity.lift)} />
        <ComputeMetric label="CoM X" value={`${aero.stability.centerOfMassY.toFixed(3)} m`} />
        <ComputeMetric
          label="CoP X"
          value={formatWithUnit(aero.stability.centerOfPressureY, 3, "m", aero.validity.lift)}
          verification={typeof machAcCadexX === "number" ? `MachUpX AC X: ${machAcCadexX.toFixed(3)} m` : undefined}
        />
        <ComputeMetric
          label="Static margin"
          note={staticMarginVerdict?.text}
          noteTone={staticMarginVerdict?.tone}
          value={formatWithUnit(aero.stability.staticMarginPct, 1, "%", aero.validity.lift)}
          verification={typeof machStaticMarginCadexPct === "number" ? `MachUpX verified: ${machStaticMarginCadexPct.toFixed(1)} %` : undefined}
        />
        <ComputeMetric label="Pitch stability" note={staticMarginVerdict?.text} noteTone={staticMarginVerdict?.tone} value={formatWithUnit(aero.stability.staticMarginPct, 1, "% SM", aero.validity.lift)} />
        <ComputeMetric label="Roll stability" note={rollVerdict?.text} noteTone={rollVerdict?.tone} value={aero.validity.lift ? aero.stability.rollStabilityLabel : "--"} />
        <ComputeMetric
          label="Dihedral effect"
          note={rollVerdict?.text}
          noteTone={rollVerdict?.tone}
          value={formatNumber(aero.stability.rollStabilityIndex, 2, aero.validity.lift)}
        />
        <ComputeMetric label="Yaw stability" note={finVolumeVerdict?.text} noteTone={finVolumeVerdict?.tone} value={formatNumber(aero.stability.finVolumeCoefficient, 3, aero.validity.finVolume)} />
        <ComputeMetric label="Horizontal tail volume" note={tailVolumeVerdict?.text} noteTone={tailVolumeVerdict?.tone} value={formatNumber(aero.stability.tailVolumeCoefficient, 3, aero.validity.tailVolume)} />
        <ComputeMetric label="Vertical fin volume" note={finVolumeVerdict?.text} noteTone={finVolumeVerdict?.tone} value={formatNumber(aero.stability.finVolumeCoefficient, 3, aero.validity.finVolume)} />
      </ComputeGroup>

      <ComputeGroup icon={<Calculator size={17} />} title="Rotors & Inertia">
        <ComputeMetric label="Rotors" value={`${aero.propulsion.rotorCount}`} />
        <ComputeMetric label="Rotor disk area" value={formatWithUnit(aero.geometry.rotorDiskAreaM2, 3, "m2", aero.validity.rotor)} />
        <ComputeMetric label="Disk loading" note={diskLoadingVerdict?.text} noteTone={diskLoadingVerdict?.tone} value={formatWithUnit(aero.propulsion.rotorDiskLoadingNpm2, 0, "N/m2", aero.validity.rotor)} />
        <ComputeMetric label="Hover thrust / rotor" value={formatWithUnit(aero.propulsion.hoverThrustPerRotorN, 1, "N", aero.validity.rotor)} />
        <ComputeMetric label="Hover power" value={formatPower(aero.propulsion.hoverPowerTotalW, aero.validity.rotor)} />
        <ComputeMetric label="Roll inertia" value={`${aero.inertia.rollKgM2.toFixed(3)} kg m2`} />
        <ComputeMetric label="Pitch inertia" value={`${aero.inertia.pitchKgM2.toFixed(3)} kg m2`} />
        <ComputeMetric label="Yaw inertia" value={`${aero.inertia.yawKgM2.toFixed(3)} kg m2`} />
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
              <ComputeMetric label="MachUpX alpha" value={formatOptionalWithUnit(machResult.alphaDeg, 1, "deg")} />
              <ComputeMetric label="MachUpX CL" value={formatOptionalNumber(machResult.CL, 3)} />
              <ComputeMetric label="MachUpX lifting CD" value={formatOptionalNumber(machResult.CD, 3)} />
              <ComputeMetric label="MachUpX L/D" value={formatOptionalNumber(machResult.LD, 1)} />
              <ComputeMetric label="Aero center X" value={formatOptionalWithUnit(machAcCadexX, 3, "m")} />
              <ComputeMetric label="Aero center Z" value={formatArrayValue(machAc?.aero_center, 2, 3, "m")} />
              <ComputeMetric label="Cm at AC" value={formatOptionalNumber(machAc?.Cm_ac, 3)} />
              <ComputeMetric label="CL alpha" value={formatOptionalNumber(machStability?.["CL,a"], 2)} />
              <ComputeMetric label="Pitch stability Cm alpha" value={formatOptionalNumber(machStability?.["Cm,a"], 2)} />
              <ComputeMetric label="Roll stability Cl beta" value={formatOptionalNumber(machStability?.["Cl_w,b"] ?? machStability?.["Cl,b"], 3)} />
              <ComputeMetric label="Yaw stability Cn beta" value={formatOptionalNumber(machStability?.["Cn_w,b"] ?? machStability?.["Cn,b"], 3)} />
              <ComputeMetric label="MachUpX static margin" value={formatOptionalWithUnit(machStaticMarginCadexPct, 1, "%")} />
              <ComputeMetric label="Roll damping" value={formatOptionalNumber(machDamping?.["Cl,pbar"], 3)} />
              <ComputeMetric label="Pitch damping" value={formatOptionalNumber(machDamping?.["Cm,qbar"], 2)} />
              <ComputeMetric label="Yaw damping" value={formatOptionalNumber(machDamping?.["Cn,rbar"], 3)} />
              <ComputeMetric label="Max section CL" value={formatOptionalNumber(machSpanwise?.maxSectionCL, 2)} />
              <ComputeMetric label="Max Reynolds" value={formatOptionalNumber(machSpanwise?.maxRe, 0)} />
              <ComputeMetric label="Solved surfaces" value={machSpanwise?.surfaceCount !== undefined ? String(machSpanwise.surfaceCount) : "--"} />
              <ComputeMetric label="Pitch trim" value={machTrim?.ok ? "available" : "no elevator control"} />
            </div>
          ) : (
            <div className="compute-machupx-grid">
              <ComputeMetric label="MachUpX status" note={machAttempt?.message ?? machUpX?.message} noteTone={machAttempt ? "bad" : "caution"} value={machAttempt ? "out of range" : "running"} />
              <ComputeMetric label="Target CL" value={formatOptionalNumber(machUpX?.targetCL ?? machAttempt?.targetCL, 3)} />
              <ComputeMetric label="Alpha low" value={formatOptionalWithUnit(machAttempt?.low?.alphaDeg, 1, "deg")} />
              <ComputeMetric label="CL low" value={formatOptionalNumber(machAttempt?.low?.CL, 3)} />
              <ComputeMetric label="Alpha high" value={formatOptionalWithUnit(machAttempt?.high?.alphaDeg, 1, "deg")} />
              <ComputeMetric label="CL high" value={formatOptionalNumber(machAttempt?.high?.CL, 3)} />
              <ComputeMetric label="Alpha zero" value={formatOptionalWithUnit(machAttempt?.sample?.alphaDeg, 1, "deg")} />
              <ComputeMetric label="CL at zero alpha" value={formatOptionalNumber(machAttempt?.sample?.CL, 3)} />
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
          <ComputeMetric label="Best endurance" value={`${sweep.bestEnduranceSpeedKt.toFixed(1)} kt`} />
          <ComputeMetric label="Best range" value={`${sweep.bestRangeSpeedKt.toFixed(1)} kt`} />
          <ComputeMetric label="Cruise target" value={`${sweep.cruiseSpeedKt.toFixed(1)} kt`} />
          <ComputeMetric label="Stall estimate" value={`${sweep.stallSpeedKt.toFixed(1)} kt`} />
          <ComputeMetric label="Min fly speed" value={`${sweep.minimumFlyableSpeedKt.toFixed(1)} kt`} />
          <ComputeMetric label={sweep.energySource} value={`${sweep.availableEnergyWh.toFixed(0)} Wh`} />
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
        <InlineInfoLabel label="Drag / power overlay" />
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
        <InlineInfoLabel label={label} />
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
  const batteryMassKg = project.shapes
    .filter((shape) => shape.role === "part" && shape.partType === "battery")
    .reduce((total, shape) => total + batteryMassEstimate(shape), 0);
  if (batteryMassKg > 0) {
    return {
      availableEnergyWh: usableEnergyFromInstalledWh(batteryMassKg * Math.max(project.mission.batteryEnergyDensityWhKg, 1), project.mission.reservePct),
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

function ComputeMetricTile({ info, label, value }: { info?: string; label: string; value: string }) {
  const resolvedInfo = info ?? computeInfoFor(label);
  return (
    <div className="compute-metric-tile">
      <span className={`metric-label ${resolvedInfo ? "has-info" : ""}`} data-info={resolvedInfo}>
        <span>{label}</span>
        {resolvedInfo ? <span className="metric-tooltip">{resolvedInfo}</span> : null}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function InlineInfoLabel({ label }: { label: string }) {
  const info = computeInfoFor(label);
  return (
    <span className={`metric-label ${info ? "has-info" : ""}`} data-info={info}>
      <span>{label}</span>
      {info ? <span className="metric-tooltip">{info}</span> : null}
    </span>
  );
}

function formatNumber(value: number, decimals: number, valid = true) {
  return valid && Number.isFinite(value) ? value.toFixed(decimals) : "--";
}

function formatWithUnit(value: number, decimals: number, unit: string, valid = true) {
  return valid && Number.isFinite(value) ? `${value.toFixed(decimals)} ${unit}` : "--";
}

function formatLexClMax(aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>) {
  if (!aero.validity.lift) return "--";
  if (!aero.lex.active && !aero.rotorBlownWing.active && !aero.wingevon.active) return aero.aerodynamics.maxLiftCoefficientClean.toFixed(2);
  return `${aero.aerodynamics.maxLiftCoefficientClean.toFixed(2)} clean / ${aero.aerodynamics.maxLiftCoefficientWithLex.toFixed(2)} applied`;
}

function formatStallAoA(aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>) {
  if (!aero.validity.lift) return "--";
  const clean = aero.aerodynamics.stallAngleCleanDeg;
  const applied = aero.aerodynamics.stallAngleDeg;
  if (!aero.lex.active && !aero.rotorBlownWing.active && !aero.wingevon.active) return `${applied.toFixed(1)} deg`;
  return `${clean.toFixed(1)} deg / ${applied.toFixed(1)} deg`;
}

function flightRegimeFor(aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>) {
  if (!aero.validity.lift) return { label: "--", tone: undefined as undefined };
  const required = aero.aerodynamics.liftCoefficient;
  const clean = Math.max(aero.aerodynamics.maxLiftCoefficientClean, 0.001);
  const highLift = Math.max(aero.aerodynamics.maxLiftCoefficientWithLex, clean);
  if (required <= clean) return { label: "Flying", tone: "good" as const };
  if (required <= highLift) return { label: "High AoA", tone: "caution" as const };
  return { label: "Stalled", tone: "bad" as const };
}

function formatRequiredClMaxForStall(aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>, speedKt: number) {
  if (!aero.validity.lift || aero.geometry.wingAreaM2 <= 0) return "--";
  const speedMS = speedKt * 0.514444;
  const requiredClMax = (2 * aero.mass.totalMassKg * 9.80665) / Math.max(aero.assumptions.rhoKgM3 * speedMS * speedMS * aero.geometry.wingAreaM2, 0.001);
  const appliedClMax = Math.max(aero.aerodynamics.maxLiftCoefficientWithLex, 0.001);
  const margin = appliedClMax / requiredClMax;
  return `${requiredClMax.toFixed(2)} need / ${margin.toFixed(2)}x`;
}

function clMaxNote(aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>) {
  const notes = [
    aero.wingevon.active ? `Wingevon ${(aero.wingevon.areaRatio * 100).toFixed(0)}% area` : "",
    aero.lex.active ? `LEX over ${aero.lex.influencedAreaM2.toFixed(3)} m2` : "",
    aero.rotorBlownWing.active ? `rotor flow over ${aero.rotorBlownWing.blownAreaM2.toFixed(3)} m2` : "",
  ].filter(Boolean);
  return notes.length ? notes.join("; ") : undefined;
}

function buildStallMarginAdders(aero: NonNullable<ReturnType<typeof computeSketchAerodynamics>>) {
  if (!aero.validity.lift || aero.aerodynamics.stallSpeedCleanMS <= 0) return undefined;
  const cleanClMax = Math.max(aero.aerodynamics.maxLiftCoefficientClean, 0.001);
  const lexClMax = Math.max(cleanClMax + (aero.lex.active ? aero.lex.deltaMaxLiftCoefficient : 0), 0.001);
  const blownClMax = Math.max(cleanClMax + (aero.rotorBlownWing.active ? aero.rotorBlownWing.deltaMaxLiftCoefficient : 0), 0.001);
  const wingevonClMax = Math.max(cleanClMax + (aero.wingevon.active ? aero.wingevon.deltaMaxLiftCoefficient : 0), 0.001);
  const appliedClMax = Math.max(aero.aerodynamics.maxLiftCoefficientWithLex, cleanClMax);
  const cleanStallKt = aero.aerodynamics.stallSpeedCleanMS / 0.514444;
  const stallForClMax = (clMax: number) => cleanStallKt * Math.sqrt(cleanClMax / Math.max(clMax, 0.001));
  const lexStallKt = stallForClMax(lexClMax);
  const blownStallKt = stallForClMax(blownClMax);
  const wingevonStallKt = stallForClMax(wingevonClMax);
  const appliedStallKt = aero.aerodynamics.stallSpeedMS > 0
    ? aero.aerodynamics.stallSpeedMS / 0.514444
    : stallForClMax(appliedClMax);
  const cleanCruiseMargin = cleanClMax / Math.max(aero.aerodynamics.liftCoefficient, 0.001);
  const appliedCruiseMargin = appliedClMax / Math.max(aero.aerodynamics.liftCoefficient, 0.001);

  return {
    appliedCruiseMargin,
    appliedStallKt,
    blownReductionKt: Math.max(0, cleanStallKt - blownStallKt),
    cleanCruiseMargin,
    cleanStallKt,
    highAoABandKt: Math.max(0, cleanStallKt - appliedStallKt),
    lexReductionKt: Math.max(0, cleanStallKt - lexStallKt),
    marginGain: Math.max(0, appliedCruiseMargin - cleanCruiseMargin),
    totalReductionKt: Math.max(0, cleanStallKt - appliedStallKt),
    wingevonReductionKt: Math.max(0, cleanStallKt - wingevonStallKt),
  };
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
