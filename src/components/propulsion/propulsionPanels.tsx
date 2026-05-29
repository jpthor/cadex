import { Fan, Gauge, Ruler } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { metersPerSecondPerKnot } from "../../app/constants";
import type { PropulsionTabState } from "../../app/types";
import { Metric, MetricTile, ResultGroup } from "../ui/Metric";
import {
  batterySamples,
  computePropulsionSizing,
  findBestPropulsionCombo,
  motorSamples,
  propellerMassEstimate,
  propellerSamples,
} from "../../propulsionEngine";
import type { BatterySample, MotorSample, PropellerSample, PropulsionInputs, RotorDefinition } from "../../propulsionEngine";
import { computeSketchAerodynamics, type SizingProject } from "../../sizing";


export function PropulsionWorkspace({
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  batteryMassKg,
  onPropulsionStateChange,
  propulsionState,
  rotorDefinition,
  sizingProject,
}: {
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  batteryMassKg: number;
  onPropulsionStateChange: (next: PropulsionTabState) => void;
  propulsionState: PropulsionTabState;
  rotorDefinition: RotorDefinition;
  sizingProject: SizingProject;
}) {
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const { selectedBatteryId, selectedMotorId, selectedPropellerId, targetEnduranceMin, targetThrustToWeight } = propulsionState;
  const selectedMotor = motorSamples.find((motor) => motor.id === selectedMotorId) ?? motorSamples[0];
  const selectedPropeller = propellerSamples.find((propeller) => propeller.id === selectedPropellerId) ?? propellerSamples[0];
  const selectedBattery = batterySamples.find((battery) => battery.id === selectedBatteryId) ?? batterySamples[0];
  const rotorCount = Math.max(1, rotorDefinition.count);
  const bladeCount = Math.max(1, rotorDefinition.bladeCount);
  const inputs = useMemo<PropulsionInputs>(() => ({ rotorPitchIn: selectedPropeller.pitchIn }), [selectedPropeller.pitchIn]);
  const batteryInputs = useMemo(
    () => ({ cells: selectedBattery.cells, cRating: selectedBattery.cRating }),
    [selectedBattery.cRating, selectedBattery.cells],
  );
  const result = useMemo(
    () => computePropulsionSizing(aircraftMassKg, rotorCount, bladeCount, rotorDefinition.diameterM, inputs, batteryInputs, batteryMassKg, batteryEnergyDensityWhKg, selectedPropeller, selectedMotor, selectedBattery),
    [aircraftMassKg, batteryEnergyDensityWhKg, batteryInputs, batteryMassKg, bladeCount, inputs, rotorCount, rotorDefinition.diameterM, selectedBattery, selectedMotor, selectedPropeller],
  );
  const aircraftCompute = useMemo(() => (sizingProject.shapes.length ? computeSketchAerodynamics(sizingProject) : undefined), [sizingProject]);
  const propulsionDemand = useMemo(
    () => propulsionDemandFromAircraft({
      aircraftMassKg,
      aircraftCompute,
      battery: selectedBattery,
      motor: selectedMotor,
      rotorCount,
      targetEnduranceMin,
      targetThrustToWeight,
    }),
    [aircraftCompute, aircraftMassKg, rotorCount, selectedBattery, selectedMotor, targetEnduranceMin, targetThrustToWeight],
  );
  const comboCandidates = useMemo(
    () => rankedPropulsionCombos({
      aircraftMassKg,
      batteryEnergyDensityWhKg,
      bladeCount,
      demand: propulsionDemand,
      rotorDefinition,
      rotorCount,
      targetEnduranceMin,
      targetThrustToWeight,
    }),
    [aircraftMassKg, batteryEnergyDensityWhKg, bladeCount, propulsionDemand, rotorDefinition, rotorCount, targetEnduranceMin, targetThrustToWeight],
  );
  const selectedPropDiameterM = selectedPropeller.diameterIn * 0.0254;
  const rotorDiameterMargin = rotorDefinition.diameterM > 0 ? rotorDefinition.diameterM / selectedPropDiameterM : 1;
  const motorPowerMargin = propulsionDemand.peakElectricalPowerW > 0 ? (selectedMotor.continuousPowerW * rotorCount) / propulsionDemand.peakElectricalPowerW : 0;
  const batteryEnergyMargin = propulsionDemand.requiredEnergyWh > 0 ? propulsionDemand.availableEnergyWh / propulsionDemand.requiredEnergyWh : 0;
  const batteryCurrentMargin = propulsionDemand.peakCurrentA > 0 ? propulsionDemand.batteryMaxCurrentA / propulsionDemand.peakCurrentA : 0;
  const rotorShapes = sizingProject.shapes.filter((shape) => shape.role === "part" && shape.partType === "rotor");
  const hasActualBattery = sizingProject.shapes.some((shape) => shape.role === "part" && shape.partType === "battery");
  const rotorCountSource = rotorShapes.length ? "Actual" : "Sizing";
  const rotorDiameterSource = rotorDefinition.diameterM > 0 ? "Actual" : "Sizing";
  const batterySource = hasActualBattery ? "Actual" : "Sizing";
  function findBestCombo() {
    const best = findBestPropulsionCombo({
      aircraftMassKg,
      batteryEnergyDensityWhKg,
      batteryMassKg,
      bladeCount,
      rotorDefinition,
      target: { minEnduranceMin: targetEnduranceMin, targetThrustToWeight },
    });
    if (!best) return;
    onPropulsionStateChange({
      ...propulsionState,
      selectedBatteryId: best.batteryPack.id,
      selectedMotorId: best.motor.id,
      selectedPropellerId: best.propeller.id,
    });
    setFeedbackMessage(`Selected ${best.motor.name}, ${best.propeller.name}, ${best.batteryPack.name}.`);
  }

  return (
    <main className="propulsion-workspace">
      <section className="propulsion-panel propulsion-summary-panel">
        <div className="propulsion-title">
          <Fan size={20} />
          <h2>Aircraft Inputs</h2>
        </div>
        <div className="propulsion-readouts">
          <MetricTile label="Mass (Actual)" value={`${aircraftMassKg.toFixed(2)} kg`} />
          <MetricTile label={`Rotors (${rotorCountSource})`} value={`${rotorCount}`} />
          <MetricTile label="Blades (Sizing)" value={`${bladeCount}`} />
          <MetricTile label={`Diameter (${rotorDiameterSource})`} value={formatMetersAsMm(rotorDefinition.diameterM)} />
          <MetricTile label={`Battery (${batterySource})`} value={`${batteryMassKg.toFixed(2)} kg`} />
        </div>
        <div className="propulsion-optimizer">
          <PropulsionNumberField
            label="Target T/W (Sizing)"
            step={0.1}
            value={targetThrustToWeight}
            onChange={(targetThrustToWeight) => onPropulsionStateChange({ ...propulsionState, targetThrustToWeight })}
          />
          <PropulsionNumberField
            label="Min endurance (Sizing)"
            suffix="min"
            step={1}
            value={targetEnduranceMin}
            onChange={(targetEnduranceMin) => onPropulsionStateChange({ ...propulsionState, targetEnduranceMin })}
          />
          <button className="primary-action" onClick={findBestCombo} type="button">
            Find Best Combo
          </button>
        </div>
        {feedbackMessage ? <p className="propulsion-inline-note">{feedbackMessage}</p> : null}
      </section>

      <section className="propulsion-panel propulsion-demand-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Aircraft Demand</h2>
        </div>
        <div className="propulsion-result-groups compact">
          <ResultGroup title="From Aero">
            <Metric label="Cruise power" note={demandVerdict(propulsionDemand.cruisePowerW, 0, 3000, 7000).text} noteTone={demandVerdict(propulsionDemand.cruisePowerW, 0, 3000, 7000).tone} value={formatWatts(propulsionDemand.cruisePowerW)} />
            <Metric label="Hover power" note={demandVerdict(propulsionDemand.hoverPowerW, 0, 6000, 14000).text} noteTone={demandVerdict(propulsionDemand.hoverPowerW, 0, 6000, 14000).tone} value={formatWatts(propulsionDemand.hoverPowerW)} />
            <Metric label="Peak electrical" value={formatWatts(propulsionDemand.peakElectricalPowerW)} />
            <Metric label="Mission energy" value={`${propulsionDemand.requiredEnergyWh.toFixed(0)} Wh`} />
          </ResultGroup>
          <ResultGroup title="Selected Margins">
            <Metric label="Motor power margin" note={ratioVerdict(motorPowerMargin, 1.25, 1.05).text} noteTone={ratioVerdict(motorPowerMargin, 1.25, 1.05).tone} value={`${motorPowerMargin.toFixed(2)}x`} />
            <Metric label="Battery energy margin" note={ratioVerdict(batteryEnergyMargin, 1.2, 1.0).text} noteTone={ratioVerdict(batteryEnergyMargin, 1.2, 1.0).tone} value={`${batteryEnergyMargin.toFixed(2)}x`} />
            <Metric label="Battery current margin" note={ratioVerdict(batteryCurrentMargin, 1.3, 1.05).text} noteTone={ratioVerdict(batteryCurrentMargin, 1.3, 1.05).tone} value={`${batteryCurrentMargin.toFixed(2)}x`} />
            <Metric label="Rotor diameter fit" note={ratioVerdict(rotorDiameterMargin, 1.0, 0.92).text} noteTone={ratioVerdict(rotorDiameterMargin, 1.0, 0.92).tone} value={rotorDefinition.diameterM > 0 ? `${(selectedPropDiameterM * 1000).toFixed(0)} / ${(rotorDefinition.diameterM * 1000).toFixed(0)} mm` : "not drawn"} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Motor Setup</h2>
        </div>
        <div className="propulsion-input-grid">
          <MotorSelect
            motors={motorSamples}
            selectedMotor={selectedMotor}
            onChange={(selectedMotorId) => onPropulsionStateChange({ ...propulsionState, selectedMotorId })}
          />
        </div>
        <div className="propulsion-readouts">
          <MetricTile label="Kv" value={`${selectedMotor.kvRpmV} rpm/V`} />
          <MetricTile label="Continuous power" value={`${selectedMotor.continuousPowerW} W`} />
          <MetricTile label="Max current" value={`${selectedMotor.maxCurrentA} A`} />
          <MetricTile label="Loaded RPM" value={`${result.motorLoadedRpm.toFixed(0)}`} />
        </div>
      </section>

      <section className="propulsion-panel propulsion-selection-panel">
        <div className="propulsion-title">
          <Fan size={20} />
          <h2>Best Off-The-Shelf Matches</h2>
        </div>
        <div className="propulsion-candidate-list">
          {comboCandidates.slice(0, 5).map((candidate) => (
            <button
              className={`propulsion-candidate ${candidate.pass ? "good" : candidate.caution ? "caution" : "bad"}`}
              key={`${candidate.motor.id}-${candidate.propeller.id}-${candidate.battery.id}`}
              onClick={() => {
                onPropulsionStateChange({
                  ...propulsionState,
                  selectedBatteryId: candidate.battery.id,
                  selectedMotorId: candidate.motor.id,
                  selectedPropellerId: candidate.propeller.id,
                });
                setFeedbackMessage(`Selected ${candidate.motor.name}, ${candidate.propeller.name}, ${candidate.battery.name}.`);
              }}
              type="button"
            >
              <strong>{candidate.motor.name} + {candidate.propeller.name}</strong>
              <span>{candidate.battery.name}</span>
              <em>{candidate.summary}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Propeller Setup</h2>
        </div>
        <div className="propulsion-input-grid">
          <PropellerSelect
            propellers={propellerSamples}
            selectedPropeller={selectedPropeller}
            onChange={(selectedPropellerId) => onPropulsionStateChange({ ...propulsionState, selectedPropellerId })}
          />
        </div>
        <div className="propulsion-readouts">
          <MetricTile label="Diameter" value={formatInchesAsMm(selectedPropeller.diameterIn)} />
          <MetricTile label="Pitch" value={formatInchesAsMm(selectedPropeller.pitchIn)} />
          <MetricTile label="APC static" value={`${selectedPropeller.staticThrustN.toFixed(1)} N @ ${selectedPropeller.staticRpm}`} />
          <MetricTile label="Peak efficiency" value={`${(selectedPropeller.peakEfficiency * 100).toFixed(1)}%`} />
        </div>
      </section>

      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Battery Setup</h2>
        </div>
        <div className="propulsion-input-grid">
          <BatterySelect
            batteries={batterySamples}
            selectedBattery={selectedBattery}
            onChange={(selectedBatteryId) => onPropulsionStateChange({ ...propulsionState, selectedBatteryId })}
          />
        </div>
        <div className="propulsion-readouts">
          <MetricTile label="Voltage" value={`${(batteryInputs.cells * 3.7).toFixed(1)} V`} />
          <MetricTile label="Capacity" value={`${selectedBattery.capacityAh.toFixed(1)} Ah`} />
          <MetricTile label="C rating" value={`${selectedBattery.cRating}C`} />
          <MetricTile label="Pack mass" value={`${selectedBattery.massKg.toFixed(2)} kg`} />
        </div>
      </section>

      <section className="propulsion-panel propulsion-results-panel">
        <div className="propulsion-title">
          <Ruler size={20} />
          <h2>Motor / Rotor Result</h2>
        </div>
        <div className="propulsion-result-groups">
          <ResultGroup title="Thrust">
            <Metric label="Thrust / weight" value={`${result.availableThrustToWeight.toFixed(2)}`} />
            <Metric label="Total static thrust" value={`${result.staticThrustTotalN.toFixed(1)} N (${result.staticThrustTotalKgf.toFixed(2)} kgf)`} />
            <Metric label="Per motor" value={`${result.thrustPerMotorN.toFixed(1)} N`} />
            <Metric label="Hover thrust / motor" value={`${result.requiredHoverThrustPerMotorN.toFixed(1)} N`} />
          </ResultGroup>
          <ResultGroup title="Propeller">
            <Metric label="Disk area / rotor" value={`${result.diskAreaPerRotorM2.toFixed(3)} m2`} />
            <Metric label="Disk loading" value={`${result.effectiveDiskLoadingNpm2.toFixed(1)} N/m2`} />
            <Metric label="Operating RPM" value={`${result.motorLoadedRpm.toFixed(0)}`} />
            <Metric label="Pitch speed" value={`${result.pitchSpeedMS.toFixed(1)} m/s (${result.pitchSpeedKmh.toFixed(0)} km/h)`} />
            <Metric label="Cruise estimate" value={`${result.cruiseSpeedLowMS.toFixed(1)}-${result.cruiseSpeedHighMS.toFixed(1)} m/s`} />
          </ResultGroup>
          <ResultGroup title="Electrical">
            <Metric label="Power / motor" note={ratioVerdict(selectedMotor.continuousPowerW / Math.max(result.powerPerMotorW, 1), 1.25, 1.05).text} noteTone={ratioVerdict(selectedMotor.continuousPowerW / Math.max(result.powerPerMotorW, 1), 1.25, 1.05).tone} value={`${result.powerPerMotorW.toFixed(0)} W`} />
            <Metric label="Total shaft power" value={`${result.totalPowerW.toFixed(0)} W`} />
            <Metric label="Current / motor" note={ratioVerdict(selectedMotor.maxCurrentA / Math.max(result.currentPerMotorA, 1), 1.25, 1.05).text} noteTone={ratioVerdict(selectedMotor.maxCurrentA / Math.max(result.currentPerMotorA, 1), 1.25, 1.05).tone} value={`${result.currentPerMotorA.toFixed(1)} A`} />
            <Metric label="ESC rating" value={`${result.recommendedEscA.toFixed(0)} A`} />
          </ResultGroup>
          <ResultGroup title="Battery">
            <Metric label="Battery max current" note={ratioVerdict(batteryCurrentMargin, 1.3, 1.05).text} noteTone={ratioVerdict(batteryCurrentMargin, 1.3, 1.05).tone} value={`${result.batteryMaxCurrentA.toFixed(0)} A`} />
            <Metric label="Takeoff current" value={`${result.takeoffCurrentA.toFixed(1)} A`} />
            <Metric label="Cruise current" value={`${result.cruiseCurrentA.toFixed(1)} A`} />
            <Metric label="Endurance" note={ratioVerdict(result.enduranceMin / Math.max(targetEnduranceMin, 1), 1.15, 1).text} noteTone={ratioVerdict(result.enduranceMin / Math.max(targetEnduranceMin, 1), 1.15, 1).tone} value={`${result.enduranceMin.toFixed(1)} min`} />
          </ResultGroup>
        </div>
        <p className="propulsion-note">
          Propeller samples use APC performance files for diameter, pitch, static thrust, static power, and peak efficiency.
          Endurance assumes 20% of battery capacity is used at takeoff current and the remaining 80% at cruise current.
        </p>
      </section>
    </main>
  );
}

export function MotorSelect({
  motors,
  onChange,
  selectedMotor,
}: {
  motors: MotorSample[];
  onChange: (id: string) => void;
  selectedMotor: MotorSample;
}) {
  return (
    <label className="propulsion-field propulsion-field-wide">
      <span>Motor</span>
      <div>
        <select value={selectedMotor.id} onChange={(event) => onChange(event.target.value)}>
          {motors.map((motor) => (
            <option key={motor.id} value={motor.id}>
              {motor.name}
            </option>
          ))}
        </select>
      </div>
      <small>
        {selectedMotor.kvRpmV} Kv, {selectedMotor.continuousPowerW} W continuous, {selectedMotor.maxCurrentA} A max
      </small>
    </label>
  );
}

export function BatterySelect({
  batteries,
  onChange,
  selectedBattery,
}: {
  batteries: BatterySample[];
  onChange: (id: string) => void;
  selectedBattery: BatterySample;
}) {
  return (
    <label className="propulsion-field propulsion-field-wide">
      <span>Battery</span>
      <div>
        <select value={selectedBattery.id} onChange={(event) => onChange(event.target.value)}>
          {batteries.map((battery) => (
            <option key={battery.id} value={battery.id}>
              {battery.name}
            </option>
          ))}
        </select>
      </div>
      <small>
        {(selectedBattery.cells * 3.7).toFixed(1)} V, {selectedBattery.capacityAh.toFixed(1)} Ah, {selectedBattery.cRating}C, {selectedBattery.massKg.toFixed(2)} kg
      </small>
    </label>
  );
}

export function PropellerSelect({
  onChange,
  propellers,
  selectedPropeller,
}: {
  onChange: (id: string) => void;
  propellers: PropellerSample[];
  selectedPropeller: PropellerSample;
}) {
  return (
    <label className="propulsion-field propulsion-field-wide">
      <span>Propeller</span>
      <div>
        <select value={selectedPropeller.id} onChange={(event) => onChange(event.target.value)}>
          {propellers.map((propeller) => (
            <option key={propeller.id} value={propeller.id}>
              {propeller.name}
            </option>
          ))}
        </select>
      </div>
      <small>
        {formatInchesAsMm(selectedPropeller.diameterIn)} x {formatInchesAsMm(selectedPropeller.pitchIn)}, {selectedPropeller.staticThrustN.toFixed(1)} N at {selectedPropeller.staticRpm} rpm,
        peak {(selectedPropeller.peakEfficiency * 100).toFixed(1)}%
      </small>
    </label>
  );
}

export function formatInchesAsMm(valueIn: number) {
  return `${(valueIn * 25.4).toFixed(0)} mm`;
}

export function formatMetersAsMm(valueM: number) {
  return valueM > 0 ? `${(valueM * 1000).toFixed(0)} mm` : "not set";
}

type Tone = "good" | "caution" | "bad" | "neutral";

function propulsionDemandFromAircraft({
  aircraftCompute,
  aircraftMassKg,
  battery,
  motor,
  rotorCount,
  targetEnduranceMin,
  targetThrustToWeight,
}: {
  aircraftCompute: ReturnType<typeof computeSketchAerodynamics> | undefined;
  aircraftMassKg: number;
  battery: BatterySample;
  motor: MotorSample;
  rotorCount: number;
  targetEnduranceMin: number;
  targetThrustToWeight: number;
}) {
  const cruisePowerW = Math.max(aircraftCompute?.aerodynamics.cruisePowerW ?? 0, 0);
  const hoverPowerW = Math.max(aircraftCompute?.propulsion.hoverPowerTotalW ?? 0, aircraftMassKg * 9.80665 * 10);
  const takeoffPowerW = Math.max(hoverPowerW * Math.max(targetThrustToWeight, 1), cruisePowerW * 1.6);
  const voltage = battery.cells * 3.7;
  const availableEnergyWh = voltage * battery.capacityAh;
  const hoverAllowanceMin = 2;
  const reserveFactor = 1.2;
  const requiredEnergyWh = (cruisePowerW * targetEnduranceMin) / 60 * reserveFactor + (hoverPowerW * hoverAllowanceMin) / 60;
  const peakElectricalPowerW = Math.max(takeoffPowerW, motor.continuousPowerW * rotorCount * 0.35);
  const peakCurrentA = peakElectricalPowerW / Math.max(voltage, 1);
  const batteryMaxCurrentA = battery.capacityAh * battery.cRating;
  return {
    availableEnergyWh,
    batteryMaxCurrentA,
    cruisePowerW,
    hoverPowerW,
    peakCurrentA,
    peakElectricalPowerW,
    requiredEnergyWh,
  };
}

function rankedPropulsionCombos({
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  bladeCount,
  demand,
  rotorDefinition,
  rotorCount,
  targetEnduranceMin,
  targetThrustToWeight,
}: {
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  bladeCount: number;
  demand: ReturnType<typeof propulsionDemandFromAircraft>;
  rotorDefinition: RotorDefinition;
  rotorCount: number;
  targetEnduranceMin: number;
  targetThrustToWeight: number;
}) {
  return motorSamples
    .flatMap((motor) =>
      propellerSamples.flatMap((propeller) =>
        batterySamples.map((battery) => {
          const result = computePropulsionSizing(
            aircraftMassKg,
            rotorCount,
            bladeCount,
            rotorDefinition.diameterM,
            { rotorPitchIn: propeller.pitchIn },
            { cells: battery.cells, cRating: battery.cRating },
            battery.massKg,
            batteryEnergyDensityWhKg,
            propeller,
            motor,
            battery,
          );
          const propDiameterM = propeller.diameterIn * 0.0254;
          const diameterFit = rotorDefinition.diameterM <= 0 || propDiameterM <= rotorDefinition.diameterM * 1.04;
          const thrustRatio = result.availableThrustToWeight / Math.max(targetThrustToWeight, 0.1);
          const motorPowerRatio = (motor.continuousPowerW * rotorCount) / Math.max(demand.peakElectricalPowerW, result.totalPowerW, 1);
          const energyRatio = (battery.cells * 3.7 * battery.capacityAh) / Math.max(demand.requiredEnergyWh, 1);
          const currentRatio = (battery.capacityAh * battery.cRating) / Math.max(demand.peakCurrentA, result.takeoffCurrentA, 1);
          const enduranceRatio = result.enduranceMin / Math.max(targetEnduranceMin, 1);
          const pass = diameterFit && thrustRatio >= 1 && motorPowerRatio >= 1.05 && energyRatio >= 1 && currentRatio >= 1.05;
          const caution = diameterFit && thrustRatio >= 0.85 && motorPowerRatio >= 0.85 && currentRatio >= 0.85;
          const score =
            Math.abs(thrustRatio - 1.25) * 110 +
            Math.abs(motorPowerRatio - 1.35) * 80 +
            Math.abs(energyRatio - 1.25) * 45 +
            (diameterFit ? 0 : 600) +
            (battery.massKg + (motor.massG / 1000) * rotorCount + propellerMassEstimate(propeller) * rotorCount) * 20;
          const summary = `${ratioLabel(thrustRatio)} T/W, ${ratioLabel(energyRatio)} energy, ${ratioLabel(currentRatio)} current`;
          return { battery, caution, motor, pass, propeller, result, score, summary };
        }),
      ),
    )
    .sort((a, b) => (Number(b.pass) - Number(a.pass)) || (Number(b.caution) - Number(a.caution)) || a.score - b.score);
}

function ratioLabel(value: number) {
  return `${value.toFixed(2)}x`;
}

function ratioVerdict(value: number, good: number, caution: number): { text: string; tone: Tone } {
  if (!Number.isFinite(value) || value <= 0) return { text: "not available", tone: "neutral" };
  if (value >= good) return { text: "good margin", tone: "good" };
  if (value >= caution) return { text: "tight margin", tone: "caution" };
  return { text: "undersized", tone: "bad" };
}

function demandVerdict(value: number, _good: number, caution: number, bad: number): { text: string; tone: Tone } {
  if (!Number.isFinite(value) || value <= 0) return { text: "not available", tone: "neutral" };
  if (value <= caution) return { text: "reasonable", tone: "good" };
  if (value <= bad) return { text: "demanding", tone: "caution" };
  return { text: "very demanding", tone: "bad" };
}

function formatWatts(value: number) {
  if (!Number.isFinite(value)) return "--";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kW` : `${value.toFixed(0)} W`;
}

export function PropulsionNumberField({
  label,
  suffix,
  step,
  value,
  onChange,
}: {
  label: string;
  suffix?: string;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="propulsion-field">
      <span>{label}</span>
      <div>
        <input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}
