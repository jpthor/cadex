import { Battery, Fuel, Gauge, Plane, Rocket, Ruler, Wind, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { defaultTurbineCount, turbineEngineOptions } from "../../sketch/constants";
import type { SizingProject } from "../../sizing";
import { computeSizingAnalysis, computeSketchAerodynamics } from "../../sizing";
import { PropulsionNumberField } from "../propulsion/fields";
import {
  clampNumber,
  computeSizingDraft,
  knotsToMS,
  msToKnots,
  normalizeSizingGRating,
  normalizeSizingRotorBladeCount,
} from "../sizing/sizingPanels";
import { sizingInputInfo } from "../sizing/sizingInputInfo";
import { Metric, MetricTile, ResultGroup } from "../ui/Metric";

type MaxFlow = ReturnType<typeof computeMaxFlow>;

export function MaxDashboard({
  project,
  onProjectChange,
}: {
  project: SizingProject;
  onProjectChange: (next: SizingProject) => void;
}) {
  const flow = useMemo(() => computeMaxFlow(project), [project]);

  function updateMission(patch: Partial<SizingProject["mission"]>) {
    onProjectChange({ ...project, mission: { ...project.mission, ...patch }, analysis: undefined });
  }

  return (
    <main className="propulsion-workspace max-workspace">
      <section className="propulsion-panel max-input-panel">
        <div className="propulsion-title">
          <Rocket size={20} />
          <h2>Max</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Runs Sizing, generated Sketch masses, Aero, theoretical propulsion, jet fuel, and endurance from the mission inputs.
        </p>
        <div className="sizing-input-grid">
          <PropulsionNumberField info={sizingInputInfo.Payload} label="Payload" suffix="kg" step={0.1} value={project.mission.payloadKg} onChange={(payloadKg) => updateMission({ payloadKg: Math.max(0, payloadKg) })} />
          <PropulsionNumberField info={sizingInputInfo["Takeoff T/W"]} label="Takeoff T/W" step={0.1} value={project.mission.takeoffThrustToWeight} onChange={(takeoffThrustToWeight) => updateMission({ takeoffThrustToWeight: Math.max(0.1, takeoffThrustToWeight) })} />
          <label className="propulsion-field">
            <MaxInputLabel label="G-rating" />
            <div>
              <select value={normalizeSizingGRating(project.mission.gRating)} onChange={(event) => updateMission({ gRating: normalizeSizingGRating(Number(event.target.value)) })}>
                <option value={2}>2G - 60deg bank turn</option>
                <option value={3}>3G - strong manoeuvre</option>
                <option value={4}>4G - aerobatic</option>
                <option value={5}>5G - high load</option>
                <option value={6}>6G - extreme</option>
              </select>
            </div>
          </label>
          <PropulsionNumberField info={sizingInputInfo["Cruise speed"]} label="Cruise speed" suffix="kt" step={1} value={roundInputValue(msToKnots(project.mission.cruiseSpeedMS))} onChange={(cruiseSpeedKt) => updateMission({ cruiseSpeedMS: Math.max(1, knotsToMS(cruiseSpeedKt)) })} />
          <PropulsionNumberField info={sizingInputInfo["Target cruise CL"]} label="Target cruise CL" step={0.05} value={project.mission.cruiseLiftCoefficient} onChange={(cruiseLiftCoefficient) => updateMission({ cruiseLiftCoefficient: clampNumber(cruiseLiftCoefficient, 0.25, 1.4) })} />
          <PropulsionNumberField info={sizingInputInfo["Aspect ratio"]} label="Aspect ratio" step={0.1} value={project.mission.aspectRatio} onChange={(aspectRatio) => updateMission({ aspectRatio: clampNumber(aspectRatio, 2.2, 12) })} />
          <PropulsionNumberField info={sizingInputInfo["Length ratio"]} label="Length ratio" step={0.05} value={project.mission.lengthRatio} onChange={(lengthRatio) => updateMission({ lengthRatio: clampNumber(lengthRatio, 0.45, 2) })} />
          <PropulsionNumberField info={sizingInputInfo.Endurance} label="Endurance" suffix="min" step={1} value={project.mission.enduranceMin} onChange={(enduranceMin) => updateMission({ enduranceMin: Math.max(1, enduranceMin) })} />
          <PropulsionNumberField info={sizingInputInfo["Hover allowance"]} label="Hover allowance" suffix="min" step={0.5} value={project.mission.hoverTimeMin} onChange={(hoverTimeMin) => updateMission({ hoverTimeMin: Math.max(0, hoverTimeMin) })} />
          <PropulsionNumberField info={sizingInputInfo.Reserve} label="Reserve" suffix="%" step={5} value={project.mission.reservePct} onChange={(reservePct) => updateMission({ reservePct: clampNumber(reservePct, 0, 90) })} />
          <label className="propulsion-field">
            <MaxInputLabel label="Rotor blades" />
            <div>
              <select value={project.mission.rotorBladeCount} onChange={(event) => updateMission({ rotorBladeCount: normalizeSizingRotorBladeCount(Number(event.target.value)) })}>
                <option value={2}>2 blades</option>
                <option value={3}>3 blades</option>
                <option value={4}>4 blades</option>
              </select>
            </div>
          </label>
          <PropulsionNumberField info={sizingInputInfo["Battery energy density"]} label="Battery energy density" suffix="Wh/kg" step={10} value={project.mission.batteryEnergyDensityWhKg} onChange={(batteryEnergyDensityWhKg) => updateMission({ batteryEnergyDensityWhKg: Math.max(1, batteryEnergyDensityWhKg) })} />
        </div>
      </section>

      <section className="propulsion-panel max-summary-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Endurance Closure</h2>
        </div>
        <div className="jet-metric-grid jet-base-grid">
          <MetricTile label="Final mass" value={`${flow.endurance.finalMassKg.toFixed(2)} kg`} />
          <MetricTile label="Best endurance" value={`${flow.endurance.bestEnduranceMin.toFixed(1)} min`} />
          <MetricTile label="Range" value={`${flow.endurance.rangeNm.toFixed(1)} nm`} />
          <MetricTile label="Limiter" value={flow.endurance.limiter} />
          <MetricTile label="Cruise power" value={formatPower(flow.endurance.propCruisePowerW)} />
          <MetricTile label="Jet command" value={`${flow.endurance.jetCommandPct.toFixed(0)}%`} />
        </div>
      </section>

      <section className="propulsion-panel">
        <PanelHeader icon={<Ruler size={18} />} title="Sizing" />
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Geometry">
            <Metric label="Total length" value={`${flow.draft.totalLengthM.toFixed(2)} m`} />
            <Metric label="Wing span" value={`${flow.draft.wingSpanM.toFixed(2)} m`} />
            <Metric label="Wing area" value={`${flow.draft.wingAreaM2.toFixed(3)} m2`} />
            <Metric label="Mean chord" value={`${flow.draft.meanChordM.toFixed(3)} m`} />
            <Metric label="Rotor diameter" value={`${flow.draft.rotorDiameterM.toFixed(2)} m`} />
          </ResultGroup>
          <ResultGroup title="Tail">
            <Metric label="Tail area" value={`${flow.draft.tailAreaM2.toFixed(3)} m2`} />
            <Metric label="Tail arm" value={`${flow.draft.tailArmM.toFixed(2)} m`} />
            <Metric label="Fin area" value={`${(flow.draft.finAreaPerFinM2 * 2).toFixed(3)} m2`} />
            <Metric label="Wing airfoil" value={flow.draft.wingAirfoil} />
            <Metric label="Tail airfoil" value={flow.draft.tailAirfoil} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel">
        <PanelHeader icon={<Plane size={18} />} title="Sketch" />
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Generated masses">
            <Metric label="Payload" value={`${flow.draft.payloadKg.toFixed(2)} kg`} />
            <Metric label="Structure" value={`${flow.draft.structureMassKg.toFixed(2)} kg`} />
            <Metric label="Battery" value={`${flow.draft.batteryMassKg.toFixed(2)} kg`} />
            <Metric label="Motors" value={`${flow.draft.motorMassKg.toFixed(2)} kg`} />
            <Metric label="Rotors" value={`${flow.draft.rotorMassKg.toFixed(2)} kg`} />
            <Metric label="Electronics" value={`${flow.draft.electronicsMassKg.toFixed(2)} kg`} />
          </ResultGroup>
          <ResultGroup title="Actualized sketch">
            <Metric label="Shapes generated" value={`${flow.syntheticProject.shapes.length}`} />
            <Metric label="Sketch mass" value={`${flow.analysis.totalMassKg.toFixed(2)} kg`} />
            <Metric label="CoM X" value={`${flow.analysis.com.yM.toFixed(2)} m`} />
            <Metric label="CoP X" value={`${flow.analysis.cop.yM.toFixed(2)} m`} />
            <Metric label="Static margin" value={`${flow.analysis.staticMarginPct.toFixed(1)}%`} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel">
        <PanelHeader icon={<Wind size={18} />} title="Aero" />
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Required aero">
            <Metric label="CL cruise" value={flow.aero.aerodynamics.liftCoefficient.toFixed(2)} />
            <Metric label="CD total" value={flow.aero.aerodynamics.dragCoefficient.toFixed(3)} />
            <Metric label="L/D" value={flow.aero.aerodynamics.liftToDrag.toFixed(1)} />
            <Metric label="Wing loading" value={`${flow.aero.mass.wingLoadingKgM2.toFixed(1)} kg/m2`} />
            <Metric label="Stall speed" value={`${msToKnots(flow.aero.aerodynamics.stallSpeedMS).toFixed(1)} kt`} />
          </ResultGroup>
          <ResultGroup title="Power">
            <Metric label="Cruise speed" value={`${msToKnots(project.mission.cruiseSpeedMS).toFixed(1)} kt`} />
            <Metric label="Cruise drag" value={`${flow.aero.aerodynamics.dragN.toFixed(0)} N`} />
            <Metric label="Cruise power" value={formatPower(flow.aero.aerodynamics.cruisePowerW)} />
            <Metric label="Hover power" value={formatPower(flow.draft.hoverPowerTotalW)} />
            <Metric label="Takeoff power" value={formatPower(flow.draft.takeoffPowerTotalW)} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel">
        <PanelHeader icon={<Zap size={18} />} title="Propulsion" />
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Theoretical selection">
            <Metric label="Motor" value={`${flow.propulsion.motorPowerKw.toFixed(1)} kW axial flux`} />
            <Metric label="Motor mass" value={`${flow.propulsion.motorMassKg.toFixed(2)} kg total`} />
            <Metric label="Propeller" value={`${flow.propulsion.propDiameterM.toFixed(2)} m x ${flow.propulsion.propPitchIn.toFixed(0)} in`} />
            <Metric label="Loaded RPM" value={`${flow.propulsion.rpm.toFixed(0)} rpm`} />
            <Metric label="Pitch speed" value={`${flow.propulsion.pitchSpeedKt.toFixed(0)} kt`} />
          </ResultGroup>
          <ResultGroup title="Battery">
            <Metric label="Battery mass" value={`${flow.propulsion.batteryMassKg.toFixed(2)} kg`} />
            <Metric label="Capacity" value={`${flow.propulsion.capacityAh.toFixed(0)} Ah`} />
            <Metric label="Voltage" value={`${flow.propulsion.voltageV.toFixed(1)} V`} />
            <Metric label="Takeoff current" value={`${flow.propulsion.takeoffCurrentA.toFixed(0)} A`} />
            <Metric label="Required C" value={`${flow.propulsion.requiredCRating.toFixed(1)}C`} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel">
        <PanelHeader icon={<Fuel size={18} />} title="Jet" />
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Selection">
            <Metric label="Engine" value={flow.jet.engineName} />
            <Metric label="Engines" value={`${defaultTurbineCount}`} />
            <Metric label="Engine mass" value={`${flow.jet.engineMassKg.toFixed(2)} kg`} />
            <Metric label="Fuel mass" value={`${flow.jet.fuelMassKg.toFixed(2)} kg`} />
            <Metric label="Fuel at full command" value={`${flow.jet.fuelMinutesAtFull.toFixed(0)} min`} />
          </ResultGroup>
          <ResultGroup title="Margins">
            <Metric label="Prop-only T/W" value={flow.jet.propOnlyTakeoffTW.toFixed(2)} />
            <Metric label="Hybrid T/W" value={flow.jet.hybridTakeoffTW.toFixed(2)} />
            <Metric label="Fuel time" value={formatMinutes(flow.endurance.fuelTimeMin)} />
            <Metric label="Battery time" value={formatMinutes(flow.endurance.batteryTimeMin)} />
            <Metric label="Mass penalty" value={`+${(flow.jet.engineMassKg + flow.jet.fuelMassKg).toFixed(2)} kg`} />
          </ResultGroup>
        </div>
      </section>
    </main>
  );
}

function computeMaxFlow(project: SizingProject) {
  const draft = computeSizingDraft(project);
  const syntheticProject: SizingProject = {
    ...project,
    selectedShapeId: "",
    shapes: draft.shapes,
    analysis: undefined,
  };
  const analysis = computeSizingAnalysis(syntheticProject);
  const aero = computeSketchAerodynamics(syntheticProject);
  const propulsion = theoreticalPropulsion(draft, aero, project);
  const hybrid = chooseJetAndEndurance({
    aero,
    baseMassKg: analysis.totalMassKg,
    draft,
    project,
    propulsion,
  });
  const { endurance, jet } = hybrid;
  return { aero, analysis, draft, endurance, jet, propulsion, syntheticProject };
}

function theoreticalPropulsion(draft: ReturnType<typeof computeSizingDraft>, aero: ReturnType<typeof computeSketchAerodynamics>, project: SizingProject) {
  const motorCount = 2;
  const voltageV = 24 * 3.7;
  const batteryMassKg = draft.batteryMassKg;
  const capacityAh = (batteryMassKg * project.mission.batteryEnergyDensityWhKg) / Math.max(voltageV, 0.001);
  const takeoffPowerW = Math.max(draft.takeoffPowerTotalW, aero.propulsion.hoverPowerTotalW * Math.pow(project.mission.takeoffThrustToWeight, 1.5));
  const cruisePowerW = Math.max(aero.aerodynamics.cruisePowerW, draft.cruisePowerW);
  const motorPowerKw = Math.max(takeoffPowerW / motorCount / 1000 * 1.2, cruisePowerW / motorCount / 1000 * 1.35, 1);
  const motorPowerDensityWKg = 3800;
  const motorMassKg = (motorPowerKw * 1000 / motorPowerDensityWKg) * motorCount;
  const propDiameterM = Math.max(draft.rotorDiameterM, 0.25);
  const tipSpeedLimitMS = 0.65 * 343;
  const rpm = Math.min(3200, Math.max(900, (tipSpeedLimitMS / Math.max(Math.PI * propDiameterM, 0.001)) * 60));
  const targetPitchSpeedMS = Math.max(project.mission.cruiseSpeedMS * 1.45, project.mission.cruiseSpeedMS + 8);
  const propPitchIn = Math.max(6, (targetPitchSpeedMS * 60 / Math.max(rpm, 1)) / 0.0254);
  const pitchSpeedKt = ((propPitchIn * 0.0254 * rpm) / 60) / 0.514444;
  const takeoffCurrentA = takeoffPowerW / Math.max(voltageV, 0.001);
  return {
    batteryMassKg,
    capacityAh,
    cruisePowerW,
    motorCount,
    motorMassKg,
    motorPowerKw,
    pitchSpeedKt,
    propDiameterM,
    propPitchIn,
    requiredCRating: takeoffCurrentA / Math.max(capacityAh, 0.001),
    rpm,
    takeoffCurrentA,
    takeoffPowerW,
    voltageV,
  };
}

function chooseJetAndEndurance({
  aero,
  baseMassKg,
  draft,
  project,
  propulsion,
}: {
  aero: ReturnType<typeof computeSketchAerodynamics>;
  baseMassKg: number;
  draft: ReturnType<typeof computeSizingDraft>;
  project: SizingProject;
  propulsion: ReturnType<typeof theoreticalPropulsion>;
}) {
  const targetTW = Math.max(project.mission.takeoffThrustToWeight, 0.1);
  const targetEnduranceMin = Math.max(project.mission.enduranceMin, 1);
  const propTakeoffThrustN = Math.max(draft.totalThrustN, baseMassKg * 9.80665 * targetTW);
  const fuelMinuteOptions = [5, 10, 15, 20, 30, 45, 60, 90];
  const candidates = turbineEngineOptions.flatMap((engine) =>
    fuelMinuteOptions.map((fuelMinutesAtFull) => {
      const engineMassKg = engine.engineWeightKg * defaultTurbineCount;
      const fuelMassKg = engine.fuelKgPerMin * fuelMinutesAtFull * defaultTurbineCount;
      const finalMassKg = baseMassKg + engineMassKg + fuelMassKg;
      const propOnlyTakeoffTW = propTakeoffThrustN / Math.max(finalMassKg * 9.80665, 0.001);
      const hybridTakeoffTW = (propTakeoffThrustN + engine.thrustN * defaultTurbineCount) / Math.max(finalMassKg * 9.80665, 0.001);
      const jet = {
        engine,
        engineMassKg,
        engineName: `${engine.maker} ${engine.model}`,
        fuelMassKg,
        fuelMinutesAtFull,
        hybridTakeoffTW,
        propOnlyTakeoffTW,
      };
      const endurance = computeBestEndurance({
        aero,
        finalMassKg,
        fuelMassKg,
        jet,
        project,
        propulsion,
      });
      const twShortfall = Math.max(0, targetTW - hybridTakeoffTW);
      const enduranceShortfall = Math.max(0, targetEnduranceMin - endurance.bestEnduranceMin);
      const enduranceOvershoot = Math.max(0, endurance.bestEnduranceMin - targetEnduranceMin);
      const fuelBatteryMismatch = endurance.batteryTimeMin > 0 && endurance.fuelTimeMin > 0
        ? Math.abs(endurance.batteryTimeMin - endurance.fuelTimeMin) / Math.max(Math.min(endurance.batteryTimeMin, endurance.fuelTimeMin), 0.001)
        : 10;
      const packageMassKg = engineMassKg + fuelMassKg;
      const feasible = twShortfall <= 0 && enduranceShortfall <= 0;
      const score = feasible
        ? packageMassKg * 5 + enduranceOvershoot * 0.25 + fuelBatteryMismatch * 1.5 + Math.max(0, engine.thrustN * defaultTurbineCount - baseMassKg * 9.80665 * 0.35) * 0.003
        : 10000 + twShortfall * 3000 + enduranceShortfall * 180 + packageMassKg * 5;
      return { endurance, jet, score };
    }),
  );
  return candidates.sort((a, b) => a.score - b.score)[0];
}

function computeBestEndurance({
  aero,
  finalMassKg,
  fuelMassKg,
  jet,
  project,
  propulsion,
}: {
  aero: ReturnType<typeof computeSketchAerodynamics>;
  finalMassKg: number;
  fuelMassKg: number;
  jet: {
    engine: (typeof turbineEngineOptions)[number];
    engineMassKg: number;
    engineName: string;
    fuelMassKg: number;
    fuelMinutesAtFull: number;
    hybridTakeoffTW: number;
    propOnlyTakeoffTW: number;
  };
  project: SizingProject;
  propulsion: ReturnType<typeof theoreticalPropulsion>;
}) {
  const reserveFraction = clampNumber(project.mission.reservePct / 100, 0, 0.9);
  const usableBatteryWh = propulsion.batteryMassKg * project.mission.batteryEnergyDensityWhKg * (1 - reserveFraction);
  const takeoffEnergyWh = propulsion.takeoffPowerW * (Math.max(project.mission.hoverTimeMin, 0) / 60);
  const cruiseBatteryWh = Math.max(0, usableBatteryWh - takeoffEnergyWh);
  const rho = aero.assumptions.rhoKgM3;
  const speedMS = Math.max(project.mission.cruiseSpeedMS, 1);
  const q = 0.5 * rho * speedMS * speedMS;
  const wingArea = Math.max(aero.geometry.wingAreaM2, 0.001);
  const aspectRatio = Math.max(aero.geometry.aspectRatio, 0.1);
  const propulsiveEfficiency = 0.76;
  const parasiteCd = aero.aerodynamics.parasiteDragCoefficient || 0.07;
  const cl = (finalMassKg * 9.80665) / Math.max(q * wingArea, 0.001);
  const cd = parasiteCd + (cl * cl) / Math.max(Math.PI * aero.assumptions.oswaldEfficiency * aspectRatio, 0.001);
  const dragN = q * wingArea * cd;
  const fuelCommands = fuelMassKg > 0 ? [10, 20, 30, 40, 50, 65, 80, 100] : [0];
  const candidates = fuelCommands.map((jetCommandPct) => {
    const command = jetCommandPct / 100;
    const jetThrustN = jet.engine.thrustN * defaultTurbineCount * command;
    const jetUsefulPowerW = jetThrustN * speedMS;
    const propCruisePowerW = Math.max(0, (dragN * speedMS - jetUsefulPowerW) / propulsiveEfficiency);
    const batteryTimeMin = propCruisePowerW > 1 ? (cruiseBatteryWh / propCruisePowerW) * 60 : Number.POSITIVE_INFINITY;
    const fuelBurnKgMin = jet.engine.fuelKgPerMin * defaultTurbineCount * command;
    const fuelTimeMin = fuelBurnKgMin > 0 ? fuelMassKg / fuelBurnKgMin : Number.POSITIVE_INFINITY;
    const bestEnduranceMin = Math.min(batteryTimeMin, fuelTimeMin);
    const limiter = batteryTimeMin <= fuelTimeMin ? "battery" : "fuel";
    return {
      batteryTimeMin,
      bestEnduranceMin,
      finalMassKg,
      fuelTimeMin,
      jetCommandPct,
      limiter,
      propCruisePowerW,
      rangeNm: (bestEnduranceMin / 60) * (speedMS / 0.514444),
    };
  });
  return candidates
    .filter((candidate) => Number.isFinite(candidate.bestEnduranceMin))
    .sort((a, b) => b.bestEnduranceMin - a.bestEnduranceMin)[0] ?? {
      batteryTimeMin: 0,
      bestEnduranceMin: 0,
      finalMassKg,
      fuelTimeMin: 0,
      jetCommandPct: 0,
      limiter: "none",
      propCruisePowerW: 0,
      rangeNm: 0,
    };
}

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="propulsion-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function MaxInputLabel({ label }: { label: string }) {
  const info = sizingInputInfo[label];
  return (
    <span className={`field-label ${info ? "has-info" : ""}`}>
      {label}
      {info ? <span className="field-tooltip">{info}</span> : null}
    </span>
  );
}

function formatPower(valueW: number) {
  if (!Number.isFinite(valueW)) return "-";
  return valueW >= 1000 ? `${(valueW / 1000).toFixed(2)} kW` : `${valueW.toFixed(0)} W`;
}

function formatMinutes(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)} min`;
}

function roundInputValue(value: number) {
  return Math.round(value * 10) / 10;
}
