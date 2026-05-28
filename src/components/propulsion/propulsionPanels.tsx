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
import { computeSizingAnalysis, type SizingProject } from "../../sizing";


export function PropulsionWorkspace({
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  batteryMassKg,
  onPropulsionStateChange,
  onSizingProjectChange,
  propulsionState,
  rotorDefinition,
  sizingProject,
}: {
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  batteryMassKg: number;
  onPropulsionStateChange: (next: PropulsionTabState) => void;
  onSizingProjectChange: (next: SizingProject) => void;
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

  function feedBackToSizing() {
    const next = applyPropulsionMassesToSizing(sizingProject, {
      batteryMassKg: selectedBattery.massKg,
      motorMassKg: (selectedMotor.massG / 1000) * rotorCount,
      rotorMassKg: propellerMassEstimate(selectedPropeller) * rotorCount,
    });
    onSizingProjectChange({ ...next, analysis: computeSizingAnalysis(next) });
    setFeedbackMessage("Sizing masses updated from the selected motor, propeller, and battery.");
  }
  return (
    <main className="propulsion-workspace">
      <section className="propulsion-panel propulsion-summary-panel">
        <div className="propulsion-title">
          <Fan size={20} />
          <h2>From Sizing</h2>
        </div>
        <div className="propulsion-readouts">
          <MetricTile label="Mass" value={`${aircraftMassKg.toFixed(2)} kg`} />
          <MetricTile label="Rotors" value={`${rotorCount}`} />
          <MetricTile label="Blades" value={`${bladeCount}`} />
          <MetricTile label="Diameter" value={formatMetersAsMm(rotorDefinition.diameterM)} />
          <MetricTile label="Battery" value={`${batteryMassKg.toFixed(2)} kg`} />
        </div>
        <div className="propulsion-optimizer">
          <PropulsionNumberField
            label="Target T/W"
            step={0.1}
            value={targetThrustToWeight}
            onChange={(targetThrustToWeight) => onPropulsionStateChange({ ...propulsionState, targetThrustToWeight })}
          />
          <PropulsionNumberField
            label="Min endurance"
            suffix="min"
            step={1}
            value={targetEnduranceMin}
            onChange={(targetEnduranceMin) => onPropulsionStateChange({ ...propulsionState, targetEnduranceMin })}
          />
          <button className="primary-action" onClick={findBestCombo} type="button">
            Find Best Combo
          </button>
          <button className="secondary-action" onClick={feedBackToSizing} type="button">
            Feed back to Sizing
          </button>
        </div>
        {feedbackMessage ? <p className="propulsion-inline-note">{feedbackMessage}</p> : null}
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
            <Metric label="Power / motor" value={`${result.powerPerMotorW.toFixed(0)} W`} />
            <Metric label="Total shaft power" value={`${result.totalPowerW.toFixed(0)} W`} />
            <Metric label="Current / motor" value={`${result.currentPerMotorA.toFixed(1)} A`} />
            <Metric label="ESC rating" value={`${result.recommendedEscA.toFixed(0)} A`} />
          </ResultGroup>
          <ResultGroup title="Battery">
            <Metric label="Battery max current" value={`${result.batteryMaxCurrentA.toFixed(0)} A`} />
            <Metric label="Takeoff current" value={`${result.takeoffCurrentA.toFixed(1)} A`} />
            <Metric label="Cruise current" value={`${result.cruiseCurrentA.toFixed(1)} A`} />
            <Metric label="Endurance" value={`${result.enduranceMin.toFixed(1)} min`} />
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

export function applyPropulsionMassesToSizing(
  sizing: SizingProject,
  masses: { batteryMassKg: number; motorMassKg: number; rotorMassKg: number },
) {
  const massByPartType = {
    battery: masses.batteryMassKg,
    motor: masses.motorMassKg,
    rotor: masses.rotorMassKg,
  } as const;
  const partCounts = sizing.shapes.reduce(
    (counts, shape) => {
      if (shape.role === "part" && shape.partType && shape.partType in massByPartType) {
        counts[shape.partType as keyof typeof massByPartType] += 1;
      }
      return counts;
    },
    { battery: 0, motor: 0, rotor: 0 },
  );
  const shapes = sizing.shapes.map((shape) => {
    if (shape.role !== "part" || !shape.partType || !(shape.partType in massByPartType)) return shape;
    const partType = shape.partType as keyof typeof massByPartType;
    const count = Math.max(partCounts[partType], 1);
    return { ...shape, massKg: massByPartType[partType] / count };
  });
  return { ...sizing, shapes };
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
