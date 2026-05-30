import { ClipboardCheck, Fan, Fuel, Gauge, PlaneTakeoff, Scale, Wind } from "lucide-react";
import { batteryMassFromSizing, computePropulsionSizing, rotorDefinitionFromSizing } from "../../propulsionEngine";
import { batterySamples, motorSamples, propellerMassEstimate, propellerSamples } from "../../propulsionEngine";
import type { PropulsionTabState } from "../../app/types";
import { computeJetComparison } from "../../jetEngine";
import { computeSizingAnalysis, computeSketchAerodynamics } from "../../sizing";
import type { SizingProject } from "../../sizing";
import { Metric, MetricTile, ResultGroup } from "../ui/Metric";

export function FinalDashboard({
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  propulsionState,
  projectName,
  sizingProject,
}: {
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  propulsionState: PropulsionTabState;
  projectName: string;
  sizingProject: SizingProject;
}) {
  const hasSketch = sizingProject.shapes.length > 0;
  const analysis = hasSketch ? computeSizingAnalysis(sizingProject) : undefined;
  const aero = hasSketch ? computeSketchAerodynamics(sizingProject) : undefined;
  const jet = computeJetComparison({
    aircraftMassKg,
    batteryEnergyDensityWhKg,
    propulsionState,
    sizingProject,
  });
  const rotorDefinition = rotorDefinitionFromSizing(sizingProject);
  const selectedBattery = batterySamples.find((battery) => battery.id === propulsionState.selectedBatteryId) ?? batterySamples[0];
  const selectedMotor = motorSamples.find((motor) => motor.id === propulsionState.selectedMotorId) ?? motorSamples[0];
  const selectedPropeller = propellerSamples.find((propeller) => propeller.id === propulsionState.selectedPropellerId) ?? propellerSamples[0];
  const rotorCount = Math.max(1, rotorDefinition.count);
  const bladeCount = Math.max(1, rotorDefinition.bladeCount);
  const sketchBatteryMassKg = batteryMassFromSizing(sizingProject);
  const propulsion = computePropulsionSizing(
    aircraftMassKg,
    rotorCount,
    bladeCount,
    rotorDefinition.diameterM,
    { rotorPitchIn: selectedPropeller.pitchIn },
    { cells: selectedBattery.cells, cRating: selectedBattery.cRating },
    sketchBatteryMassKg,
    batteryEnergyDensityWhKg,
    selectedPropeller,
    selectedMotor,
    selectedBattery,
  );
  const jetPackageMassKg = jet.engineMassKg + jet.fuelMassKg;
  const bestEndurance = jet.enduranceAssistBest.enduranceMin > jet.bestRangeCommand.enduranceMin
    ? jet.enduranceAssistBest
    : jet.bestRangeCommand;
  const shapeCounts = countSketchShapes(sizingProject);
  const warnings = uniqueStrings([...(analysis?.warnings ?? []), ...(aero?.warnings ?? []), ...jetWarnings(jet)]);

  if (!hasSketch || !analysis || !aero) {
    return (
      <main className="propulsion-workspace final-workspace">
        <section className="propulsion-panel compute-empty">
          <h2>Final</h2>
          <p>Draw the aircraft in Sketch before creating the engineering handoff.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="propulsion-workspace final-workspace">
      <section className="propulsion-panel final-hero-panel">
        <div className="propulsion-title">
          <ClipboardCheck size={20} />
          <h2>Final Engineering Handoff</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Recomputed from the current sketch, Sizing mission, Propulsion selection, Jet setup, and Endurance analysis. This is the read-only package to hand to engineering.
        </p>
        <div className="jet-metric-grid final-summary-grid">
          <MetricTile label="Aircraft" value={projectName} />
          <MetricTile label="Hybrid takeoff mass" value={`${jet.aircraftMassKg.toFixed(2)} kg`} />
          <MetricTile label="Dry mass after fuel" value={`${jet.dryMassKg.toFixed(2)} kg`} />
          <MetricTile label="Best range" value={`${Math.max(jet.bestRangeCommand.rangeNm, jet.enduranceAssistBest.rangeNm).toFixed(1)} nm`} />
          <MetricTile label="Best endurance" value={`${bestEndurance.enduranceMin.toFixed(1)} min`} />
          <MetricTile label="Best endurance speed" value={`${bestEndurance.speedKt.toFixed(1)} kt`} />
        </div>
      </section>

      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Scale size={20} />
          <h2>Mass</h2>
        </div>
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Aircraft">
            <Metric label="Sketch mass" value={`${analysis.totalMassKg.toFixed(2)} kg`} />
            <Metric label="Prop-only mass" value={`${jet.propOnlyMassKg.toFixed(2)} kg`} />
            <Metric label="Hybrid takeoff mass" value={`${jet.aircraftMassKg.toFixed(2)} kg`} />
            <Metric label="Hybrid dry mass" value={`${jet.dryMassKg.toFixed(2)} kg`} />
          </ResultGroup>
          <ResultGroup title="Jet Package">
            <Metric label="Engine mass" value={`${jet.engineMassKg.toFixed(2)} kg`} />
            <Metric label="Fuel mass" value={`${jet.fuelMassKg.toFixed(2)} kg`} />
            <Metric label="Engine + fuel" value={`${jetPackageMassKg.toFixed(2)} kg`} />
            <Metric label="Engines" value={`${jet.engineCount}`} />
          </ResultGroup>
          <ResultGroup title="Propulsion Package">
            <Metric label="Battery mass" value={`${jet.batteryMassKg.toFixed(2)} kg`} />
            <Metric label="Motor mass" value={`${((selectedMotor.massG / 1000) * rotorCount).toFixed(2)} kg`} />
            <Metric label="Propeller mass" value={`${(propellerMassEstimate(selectedPropeller) * rotorCount).toFixed(2)} kg`} />
            <Metric label="Sketch battery mass" value={`${sketchBatteryMassKg.toFixed(2)} kg`} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Wind size={20} />
          <h2>Aero</h2>
        </div>
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Geometry">
            <Metric label="Wing area" value={formatArea(aero.geometry.wingAreaM2, aero.validity.lift)} />
            <Metric label="Wing span" value={formatLength(aero.geometry.wingSpanM, aero.validity.lift)} />
            <Metric label="Mean chord" value={formatLength(aero.geometry.meanChordM, aero.validity.lift)} />
            <Metric label="Aspect ratio" value={formatNumber(aero.geometry.aspectRatio, 2, aero.validity.lift)} />
          </ResultGroup>
          <ResultGroup title="Cruise">
            <Metric label="Cruise speed" value={`${aero.aerodynamics.cruiseSpeedKt.toFixed(1)} kt`} />
            <Metric label="CL" value={formatNumber(aero.aerodynamics.liftCoefficient, 3, aero.validity.lift)} />
            <Metric label="CD" value={formatNumber(aero.aerodynamics.dragCoefficient, 3, aero.validity.drag)} />
            <Metric label="L/D" value={formatNumber(aero.aerodynamics.liftToDrag, 1, aero.validity.lift)} />
            <Metric label="Cruise power" value={formatPower(aero.aerodynamics.cruisePowerW, aero.validity.drag)} />
          </ResultGroup>
          <ResultGroup title="Stability">
            <Metric label="Stall speed" value={aero.validity.lift ? `${(aero.aerodynamics.stallSpeedMS / 0.514444).toFixed(1)} kt` : "--"} />
            <Metric label="CoM X" value={`${aero.stability.centerOfMassY.toFixed(3)} m`} />
            <Metric label="CoP X" value={aero.validity.lift ? `${aero.stability.centerOfPressureY.toFixed(3)} m` : "--"} />
            <Metric label="Static margin" value={aero.validity.lift ? `${aero.stability.staticMarginPct.toFixed(1)}%` : "--"} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Fan size={20} />
          <h2>Propulsion</h2>
        </div>
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Selected Hardware">
            <Metric label="Battery" value={selectedBattery.name} />
            <Metric label="Motor" value={`${selectedMotor.name}, ${(selectedMotor.continuousPowerW / 1000).toFixed(1)} kW`} />
            <Metric label="Propeller" value={`${selectedPropeller.name}, ${(selectedPropeller.diameterIn * 0.0254).toFixed(2)} m`} />
            <Metric label="Rotors" value={`${rotorCount} x ${bladeCount} blades`} />
          </ResultGroup>
          <ResultGroup title="Electrical">
            <Metric label="Nominal voltage" value={`${jet.batteryVoltageNominalV.toFixed(1)} V`} />
            <Metric label="Battery capacity" value={`${jet.batteryCapacityAh.toFixed(1)} Ah`} />
            <Metric label="Motor loaded RPM" value={`${propulsion.motorLoadedRpm.toFixed(0)} rpm`} />
            <Metric label="Pitch speed" value={`${jet.propFullPitchSpeedKt.toFixed(1)} kt`} />
          </ResultGroup>
          <ResultGroup title="Margins">
            <Metric label="100% T/W" value={jet.feasibility.hybridHoverThrustToWeight.toFixed(2)} />
            <Metric label="Takeoff target T/W" value={jet.feasibility.targetThrustToWeight.toFixed(2)} />
            <Metric label="Required thrust" value={`${jet.feasibility.requiredTakeoffThrustN.toFixed(0)} N`} />
            <Metric label="Available thrust" value={`${(jet.propFullBatteryThrustN + jet.engine.thrustN * jet.engineCount).toFixed(0)} N`} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Fuel size={20} />
          <h2>Jet And Endurance</h2>
        </div>
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Jet Setup">
            <Metric label="Engine" value={`${jet.engine.maker} ${jet.engine.model}`} />
            <Metric label="Total jet thrust" value={`${(jet.engine.thrustN * jet.engineCount).toFixed(0)} N`} />
            <Metric label="Fuel at full command" value={`${jet.fuelMinutesAtFullCommand.toFixed(1)} min`} />
            <Metric label="Fuel mass" value={`${jet.fuelMassKg.toFixed(2)} kg`} />
          </ResultGroup>
          <ResultGroup title="Jet Best Range">
            <Metric label="Command" value={`${jet.bestRangeCommand.commandPct.toFixed(0)}%`} />
            <Metric label="Speed" value={`${jet.bestRangeCommand.speedKt.toFixed(1)} kt`} />
            <Metric label="Endurance" value={`${jet.bestRangeCommand.enduranceMin.toFixed(1)} min`} />
            <Metric label="Range" value={`${jet.bestRangeCommand.rangeNm.toFixed(1)} nm`} />
          </ResultGroup>
          <ResultGroup title="Endurance Assist">
            <Metric label="Prop command" value={`${jet.enduranceAssistBest.propCommandPct.toFixed(0)}%`} />
            <Metric label="Jet command" value={`${jet.enduranceAssistBest.commandPct.toFixed(0)}%`} />
            <Metric label="Endurance" value={`${jet.enduranceAssistBest.enduranceMin.toFixed(1)} min`} />
            <Metric label="Range" value={`${jet.enduranceAssistBest.rangeNm.toFixed(1)} nm`} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel final-checklist-panel">
        <div className="propulsion-title">
          <PlaneTakeoff size={20} />
          <h2>Engineering Checklist</h2>
        </div>
        <div className="final-checklist-grid">
          <ResultGroup title="Model Contents">
            <Metric label="Bodies" value={`${shapeCounts.bodies}`} />
            <Metric label="Wings" value={`${shapeCounts.wings}`} />
            <Metric label="Wingevons" value={`${shapeCounts.wingevons}`} />
            <Metric label="Tailplanes" value={`${shapeCounts.tailplanes}`} />
            <Metric label="Fins" value={`${shapeCounts.fins}`} />
            <Metric label="Parts" value={`${shapeCounts.parts}`} />
          </ResultGroup>
          <ResultGroup title="Warnings">
            {warnings.length ? warnings.map((warning) => <Metric key={warning} label="Check" value={warning} />) : <Metric label="Checks" value="No first-pass warnings" />}
          </ResultGroup>
        </div>
      </section>
    </main>
  );
}

function countSketchShapes(project: SizingProject) {
  return {
    bodies: project.shapes.filter((shape) => shape.role === "body").length,
    wings: project.shapes.filter((shape) => shape.role === "liftingSurface" && (shape.liftingSurfaceKind ?? "wing") === "wing").length,
    wingevons: project.shapes.filter((shape) => shape.role === "liftingSurface" && shape.liftingSurfaceKind === "wingevon").length,
    tailplanes: project.shapes.filter((shape) => shape.role === "liftingSurface" && shape.liftingSurfaceKind === "tailplane").length,
    fins: project.shapes.filter((shape) => shape.role === "liftingSurface" && shape.liftingSurfaceKind === "fin").length,
    parts: project.shapes.filter((shape) => shape.role === "part").length,
  };
}

function jetWarnings(jet: ReturnType<typeof computeJetComparison>) {
  return [
    jet.feasibility.hybridThrustDeficitN > 0 ? `Hybrid thrust is short by ${jet.feasibility.hybridThrustDeficitN.toFixed(0)} N at takeoff target.` : "",
    jet.bestRangeCommand.pitchOverspeedPct > 0.5 ? `Best range exceeds prop pitch speed by ${jet.bestRangeCommand.pitchOverspeedPct.toFixed(0)}%.` : "",
    !jet.bestRangeCommand.flyable ? `Best range point is below minimum flyable speed ${jet.bestRangeCommand.minimumFlyableSpeedKt.toFixed(1)} kt.` : "",
    !jet.enduranceAssistBest.flyable ? `Endurance point is below minimum flyable speed ${jet.enduranceAssistBest.minimumFlyableSpeedKt.toFixed(1)} kt.` : "",
  ].filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatArea(value: number, valid = true) {
  return valid ? `${value.toFixed(3)} m2` : "--";
}

function formatLength(value: number, valid = true) {
  return valid ? `${value.toFixed(2)} m` : "--";
}

function formatNumber(value: number, digits: number, valid = true) {
  return valid && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function formatPower(value: number, valid = true) {
  if (!valid || !Number.isFinite(value)) return "--";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} kW` : `${value.toFixed(0)} W`;
}
