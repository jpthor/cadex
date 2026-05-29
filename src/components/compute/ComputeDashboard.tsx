import { invoke } from "@tauri-apps/api/core";
import { Activity, AlertTriangle, Calculator, Gauge, Wind } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { computeSketchAerodynamics, computeSizingAnalysis } from "../../sizing";
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
    alphaDeg: number;
    CL: number;
    CD: number;
    Cm: number;
    LD: number;
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
  const machSolver = machResult?.solverOutputs;
  const machAc = machSolver?.aeroCenter?.ok ? machSolver.aeroCenter.value.cadex : undefined;
  const machStability = machSolver?.stabilityDerivatives?.ok ? machSolver.stabilityDerivatives.value.cadex : undefined;
  const machDamping = machSolver?.dampingDerivatives?.ok ? machSolver.dampingDerivatives.value.cadex : undefined;
  const machSpanwise = machSolver?.spanwise?.ok ? machSolver.spanwise : undefined;
  const machTrim = machSolver?.pitchTrim;
  const machAcCadexX = typeof machAc?.aero_center?.[0] === "number" ? -machAc.aero_center[0] : undefined;

  if (!aero || !analysis) {
    return (
      <main className="compute-dashboard">
        <section className="compute-panel compute-empty">
          <h2>Compute</h2>
          <p>Draw the aircraft in Sketch to get live first-pass aerodynamic numbers here.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="compute-dashboard">
      <section className="compute-panel compute-hero">
        <div>
          <h2>Sketch Compute</h2>
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
          value={formatNumber(aero.aerodynamics.liftCoefficient, 3, aero.validity.lift)}
          verification={machResult ? `MachUpX verified: ${machResult.CL.toFixed(3)}` : undefined}
        />
        <Metric label="CD induced" value={formatNumber(aero.aerodynamics.inducedDragCoefficient, 3, aero.validity.lift)} />
        <Metric label="CD parasite" value={formatNumber(aero.aerodynamics.parasiteDragCoefficient, 3, aero.validity.drag)} />
        <Metric
          label="CD total"
          value={formatNumber(aero.aerodynamics.dragCoefficient, 3, aero.validity.drag)}
          verification={machResult ? `MachUpX lifting only: ${machResult.CD.toFixed(3)}` : undefined}
        />
        <Metric label="Drag reference area" value={formatWithUnit(aero.geometry.dragReferenceAreaM2, 3, "m2", aero.validity.drag)} />
        <Metric label="Drag" value={formatWithUnit(aero.aerodynamics.dragN, 1, "N", aero.validity.drag)} />
        <Metric label="Cruise power" value={formatPower(aero.aerodynamics.cruisePowerW, aero.validity.drag)} />
        <Metric
          label="L/D"
          value={formatNumber(aero.aerodynamics.liftToDrag, 1, aero.validity.lift)}
          verification={machResult ? `MachUpX lifting only: ${machResult.LD.toFixed(1)}` : undefined}
        />
        <Metric label="Stall speed" value={formatWithUnit(aero.aerodynamics.stallSpeedMS / 0.514444, 1, "kt", aero.validity.lift)} />
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
          value={formatWithUnit(aero.stability.staticMarginPct, 1, "%", aero.validity.lift)}
          verification={typeof machStability?.["%_static_margin"] === "number" ? `MachUpX verified: ${machStability["%_static_margin"].toFixed(1)} %` : undefined}
        />
        <Metric label="Roll stability" value={aero.validity.lift ? aero.stability.rollStabilityLabel : "--"} />
        <Metric
          label="Dihedral effect"
          value={formatNumber(aero.stability.rollStabilityIndex, 2, aero.validity.lift)}
          verification={typeof (machStability?.["Cl_w,b"] ?? machStability?.["Cl,b"]) === "number" ? `MachUpX Cl beta: ${formatOptionalNumber(machStability?.["Cl_w,b"] ?? machStability?.["Cl,b"], 3)}` : undefined}
        />
        <Metric label="Horizontal tail volume" value={formatNumber(aero.stability.tailVolumeCoefficient, 3, aero.validity.tailVolume)} />
        <Metric label="Vertical fin volume" value={formatNumber(aero.stability.finVolumeCoefficient, 3, aero.validity.finVolume)} />
      </ComputeGroup>

      <ComputeGroup icon={<Calculator size={17} />} title="Rotors & Inertia">
        <Metric label="Rotors" value={`${aero.propulsion.rotorCount}`} />
        <Metric label="Rotor disk area" value={formatWithUnit(aero.geometry.rotorDiskAreaM2, 3, "m2", aero.validity.rotor)} />
        <Metric label="Disk loading" value={formatWithUnit(aero.propulsion.rotorDiskLoadingNpm2, 0, "N/m2", aero.validity.rotor)} />
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

      {machResult ? (
        <section className="compute-panel compute-wide compute-machupx-bottom">
          <PanelHeading icon={<Gauge size={17} />} title="MachUpX Solver" />
          <div className="compute-machupx-grid">
            <Metric label="MachUpX alpha" value={`${machResult.alphaDeg.toFixed(1)} deg`} />
            <Metric label="MachUpX CL" value={machResult.CL.toFixed(3)} />
            <Metric label="MachUpX lifting CD" value={machResult.CD.toFixed(3)} />
            <Metric label="MachUpX L/D" value={machResult.LD.toFixed(1)} />
            <Metric label="Aero center X" value={formatOptionalWithUnit(machAcCadexX, 3, "m")} />
            <Metric label="Aero center Z" value={formatArrayValue(machAc?.aero_center, 2, 3, "m")} />
            <Metric label="Cm at AC" value={formatOptionalNumber(machAc?.Cm_ac, 3)} />
            <Metric label="CL alpha" value={formatOptionalNumber(machStability?.["CL,a"], 2)} />
            <Metric label="Cm alpha" value={formatOptionalNumber(machStability?.["Cm,a"], 2)} />
            <Metric label="Cl beta" value={formatOptionalNumber(machStability?.["Cl_w,b"] ?? machStability?.["Cl,b"], 3)} />
            <Metric label="Cn beta" value={formatOptionalNumber(machStability?.["Cn_w,b"] ?? machStability?.["Cn,b"], 3)} />
            <Metric label="MachUpX static margin" value={formatWithUnit(machStability?.["%_static_margin"] ?? Number.NaN, 1, "%")} />
            <Metric label="Roll damping" value={formatOptionalNumber(machDamping?.["Cl,pbar"], 3)} />
            <Metric label="Pitch damping" value={formatOptionalNumber(machDamping?.["Cm,qbar"], 2)} />
            <Metric label="Yaw damping" value={formatOptionalNumber(machDamping?.["Cn,rbar"], 3)} />
            <Metric label="Max section CL" value={formatOptionalNumber(machSpanwise?.maxSectionCL, 2)} />
            <Metric label="Max Reynolds" value={formatOptionalNumber(machSpanwise?.maxRe, 0)} />
            <Metric label="Solved surfaces" value={machSpanwise?.surfaceCount !== undefined ? String(machSpanwise.surfaceCount) : "--"} />
            <Metric label="Pitch trim" value={machTrim?.ok ? "available" : "no elevator control"} />
          </div>
        </section>
      ) : null}
    </main>
  );
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

function formatPower(valueW: number, valid = true) {
  if (!valid || !Number.isFinite(valueW)) return "--";
  if (valueW < 1000) return `${valueW.toFixed(0)} W`;
  return `${(valueW / 1000).toFixed(2)} kW`;
}
