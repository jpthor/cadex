import { Fan, Gauge, Ruler } from "lucide-react";
import { useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { metersPerSecondPerKnot } from "../../app/constants";
import type { PropulsionTabState } from "../../app/types";
import { Metric, MetricTile, ResultGroup } from "../ui/Metric";
import { propulsionMetricInfo } from "./propulsionMetricInfo";
import {
  batterySamples,
  computePropulsionSizing,
  motorSamples,
  propellerMassEstimate,
  propellerSamples,
} from "../../propulsionEngine";
import type { BatterySample, MotorSample, PropellerSample, PropulsionInputs, RotorDefinition } from "../../propulsionEngine";
import { installedEnergyForMissionWh, usableEnergyFromInstalledWh } from "../../sizing/energy";
import { computeSketchAerodynamics, type SizingProject } from "../../sizing";

function propulsionInfoFor(label: string) {
  const normalized = label.replace(/\s+\([^)]*\)/g, "");
  return propulsionMetricInfo[label] ?? propulsionMetricInfo[normalized];
}

function PropulsionMetric({ info, label, ...rest }: ComponentProps<typeof Metric>) {
  return <Metric {...rest} info={info ?? propulsionInfoFor(label)} label={label} />;
}

function PropulsionMetricTile({ info, label, ...rest }: ComponentProps<typeof MetricTile>) {
  return <MetricTile {...rest} info={info ?? propulsionInfoFor(label)} label={label} />;
}

function PropulsionFieldLabel({ label }: { label: string }) {
  const info = propulsionInfoFor(label);
  return (
    <span className={`field-label ${info ? "has-info" : ""}`}>
      {label}
      {info ? <span className="field-tooltip">{info}</span> : null}
    </span>
  );
}

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
      cruisePropEfficiency: result.cruisePropEfficiency,
      loadedRpm: result.motorLoadedRpm,
      missionEnduranceMin: sizingProject.mission.enduranceMin,
      missionReservePct: sizingProject.mission.reservePct,
      missionTakeoffMin: sizingProject.mission.hoverTimeMin,
      pitchSpeedMS: result.pitchSpeedMS,
      propeller: selectedPropeller,
      rotorCount,
      targetThrustToWeight,
    }),
    [aircraftCompute, aircraftMassKg, result.cruisePropEfficiency, result.motorLoadedRpm, result.pitchSpeedMS, rotorCount, selectedPropeller, sizingProject.mission.enduranceMin, sizingProject.mission.hoverTimeMin, sizingProject.mission.reservePct, targetThrustToWeight],
  );
  const comboCandidates = useMemo(
    () => rankedPropulsionCombos({
      aircraftMassKg,
      batteryEnergyDensityWhKg,
      bladeCount,
      aircraftCompute,
      rotorDefinition,
      rotorCount,
      targetEnduranceMin,
      targetThrustToWeight,
    }),
    [aircraftCompute, aircraftMassKg, batteryEnergyDensityWhKg, bladeCount, rotorDefinition, rotorCount, targetEnduranceMin, targetThrustToWeight],
  );
  const rotorShapes = sizingProject.shapes.filter((shape) => shape.role === "part" && shape.partType === "rotor");
  const hasActualBattery = sizingProject.shapes.some((shape) => shape.role === "part" && shape.partType === "battery");
  const selectedPropDiameterM = selectedPropeller.diameterIn * 0.0254;
  const rotorDiameterMargin = rotorDefinition.diameterM > 0 ? rotorDefinition.diameterM / selectedPropDiameterM : 1;
  const rotorFitVerdict = rotorDefinition.diameterM <= 0
    ? { text: "not drawn", tone: "neutral" as Tone }
    : rotorDiameterMargin >= 1
      ? { text: "fits", tone: "good" as Tone }
      : { text: "oversize", tone: "bad" as Tone };
  const selectedBatteryVoltage = selectedBattery.cells * 3.7;
  const selectedBatteryEnergyWh = selectedBatteryVoltage * selectedBattery.capacityAh;
  const selectedBatteryMaxCurrentA = selectedBattery.capacityAh * selectedBattery.cRating;
  const selectedPeakCurrentA = propulsionDemand.peakElectricalPowerW / Math.max(selectedBatteryVoltage, 1);
  const selectedTakeoffCurrentA = propulsionDemand.takeoffElectricalPowerW / Math.max(selectedBatteryVoltage, 1);
  const selectedUsableEnergyWh = usableEnergyFromInstalledWh(selectedBatteryEnergyWh, sizingProject.mission.reservePct);
  const missionTakeoffEnergyWh = propulsionDemand.takeoffElectricalPowerW * (Math.max(sizingProject.mission.hoverTimeMin, 0) / 60);
  const selectedCruiseEnergyWh = Math.max(0, selectedUsableEnergyWh - missionTakeoffEnergyWh);
  const selectedMissionEnduranceMin = propulsionDemand.cruisePowerW > 0 ? (selectedCruiseEnergyWh / propulsionDemand.cruisePowerW) * 60 : 0;
  const motorPowerMargin = propulsionDemand.peakElectricalPowerW > 0 ? (selectedMotor.continuousPowerW * rotorCount) / propulsionDemand.peakElectricalPowerW : 0;
  const batteryEnergyMargin = propulsionDemand.requiredEnergyWh > 0 ? selectedBatteryEnergyWh / propulsionDemand.requiredEnergyWh : 0;
  const batteryCurrentMargin = selectedPeakCurrentA > 0 ? selectedBatteryMaxCurrentA / selectedPeakCurrentA : 0;
  const batteryMassMismatch = hasActualBattery && Math.abs(selectedBattery.massKg - batteryMassKg) > Math.max(0.5, batteryMassKg * 0.1);
  const takeoffThrustMargin = result.adjustedTakeoffThrustToWeight / Math.max(targetThrustToWeight, 0.1);
  const takeoffThrustVerdict = ratioVerdict(takeoffThrustMargin, 1.15, 1);
  const escDemandA = Math.max(result.currentPerMotorA, selectedTakeoffCurrentA / rotorCount, selectedPeakCurrentA / rotorCount);
  const escRatingA = escDemandA * 1.3;
  const escMarginVsMotor = selectedMotor.maxCurrentA > 0 ? selectedMotor.maxCurrentA / Math.max(escRatingA, 1) : 0;
  const escVerdict = escMarginVsMotor >= 1.05 ? { text: "motor-current ok", tone: "good" as Tone } : escMarginVsMotor >= 1 ? { text: "tight vs motor", tone: "caution" as Tone } : { text: "over motor current", tone: "bad" as Tone };
  const propellerSourceText = selectedPropeller.source.toLowerCase();
  const isEstimatedPropellerData = propellerSourceText.includes("estimate") || propellerSourceText.includes("scaled");
  const minFlySpeedMS = Math.max((aircraftCompute?.aerodynamics.stallSpeedMS ?? 0) * 1.2, 0);
  const cruiseDriver = minFlySpeedMS > 0 && Math.abs(propulsionDemand.bestCruiseSpeedMS - minFlySpeedMS) < 0.25 ? "stall margin" : "aero / prop";
  const propSpeedMargin = minFlySpeedMS > 0 && result.pitchSpeedMS > 0 ? result.pitchSpeedMS / minFlySpeedMS : 0;
  const propSpeedVerdict = propSpeedMargin >= 1.15
    ? { text: "good margin", tone: "good" as Tone }
    : propSpeedMargin >= 1
      ? { text: "tight margin", tone: "caution" as Tone }
      : { text: "below stall margin", tone: "bad" as Tone };
  const passingThrustCandidates = comboCandidates.filter((candidate) => candidate.thrustRatio >= 1);
  const visibleCandidates = (passingThrustCandidates.length ? passingThrustCandidates : comboCandidates).slice(0, 5);
  const rotorCountSource = rotorShapes.length ? "Actual" : "Sizing";
  const rotorDiameterSource = rotorDefinition.diameterM > 0 ? "Actual" : "Sizing";
  const batterySource = hasActualBattery ? "Actual" : "Sizing";
  return (
    <main className="propulsion-workspace">
      <section className="propulsion-panel propulsion-requirements-panel">
        <div className="propulsion-title">
          <Fan size={20} />
          <h2>Requirements</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Aircraft facts and mission targets from the sketch and sizing inputs, plus the power, current, and energy the selected propulsion system needs to satisfy.
        </p>
        <div className="propulsion-requirements-top">
          <div className="propulsion-readouts">
            <PropulsionMetricTile label="Mass (Actual)" value={`${aircraftMassKg.toFixed(2)} kg`} />
            <PropulsionMetricTile label={`Rotors (${rotorCountSource})`} value={`${rotorCount}`} />
            <PropulsionMetricTile label="Blades (Sizing)" value={`${bladeCount}`} />
            <PropulsionMetricTile label={`Diameter (${rotorDiameterSource})`} value={formatMetersAsMm(rotorDefinition.diameterM)} />
            <PropulsionMetricTile label={`Battery (${batterySource})`} value={`${batteryMassKg.toFixed(2)} kg`} />
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
          </div>
        </div>
        <div className="propulsion-result-groups compact propulsion-requirements-groups">
          <ResultGroup title="Power And Energy">
            <PropulsionMetric label="Cruise power" value={formatWatts(propulsionDemand.cruisePowerW)} />
            <PropulsionMetric label="Best cruise speed" value={formatSpeedKt(propulsionDemand.bestCruiseSpeedMS)} />
            <PropulsionMetric label="Hover power" value={formatWatts(propulsionDemand.hoverPowerW)} />
            <PropulsionMetric label="Takeoff electrical" value={formatWatts(propulsionDemand.takeoffElectricalPowerW)} />
            <PropulsionMetric label="Peak electrical" value={formatWatts(propulsionDemand.peakElectricalPowerW)} />
            <PropulsionMetric label="Mission energy" value={`${propulsionDemand.requiredEnergyWh.toFixed(0)} Wh`} />
            <PropulsionMetric label="Takeoff time" value={`${Math.max(sizingProject.mission.hoverTimeMin, 0).toFixed(1)} min`} />
            <PropulsionMetric label="Reserve" value={`${Math.max(sizingProject.mission.reservePct, 0).toFixed(0)}%`} />
          </ResultGroup>
          <ResultGroup title="Selected Margins">
            <PropulsionMetric label="Motor power margin" note={ratioVerdict(motorPowerMargin, 1.5, 1.2).text} noteTone={ratioVerdict(motorPowerMargin, 1.5, 1.2).tone} value={`${motorPowerMargin.toFixed(2)}x`} />
            <PropulsionMetric label="Takeoff T/W margin" note={takeoffThrustVerdict.text} noteTone={takeoffThrustVerdict.tone} value={`${takeoffThrustMargin.toFixed(2)}x`} />
            <PropulsionMetric label="Battery energy margin" value={`${batteryEnergyMargin.toFixed(2)}x`} />
            <PropulsionMetric label="Battery current margin" value={`${batteryCurrentMargin.toFixed(2)}x`} />
            <PropulsionMetric label="Battery mass match" note={batteryMassMismatch ? "actual differs" : "ok"} noteTone={batteryMassMismatch ? "bad" : "good"} value={hasActualBattery ? `${selectedBattery.massKg.toFixed(1)} / ${batteryMassKg.toFixed(1)} kg` : "not drawn"} />
            <PropulsionMetric label="Rotor diameter fit" note={rotorFitVerdict.text} noteTone={rotorFitVerdict.tone} value={rotorDefinition.diameterM > 0 ? `${(selectedPropDiameterM * 1000).toFixed(0)} / ${(rotorDefinition.diameterM * 1000).toFixed(0)} mm` : "not drawn"} />
          </ResultGroup>
        </div>
        {feedbackMessage ? <p className="propulsion-inline-note">{feedbackMessage}</p> : null}
      </section>

      <section className="propulsion-panel propulsion-selection-panel">
        <div className="propulsion-title">
          <Fan size={20} />
          <h2>Best Off-The-Shelf Matches</h2>
        </div>
        <div className="propulsion-candidate-list">
          {visibleCandidates.map((candidate) => (
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
          {!passingThrustCandidates.length ? <p className="propulsion-inline-note">No listed combo meets the target takeoff thrust-to-weight yet.</p> : null}
        </div>
      </section>

      <section className="propulsion-panel propulsion-hardware-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Selected Hardware</h2>
        </div>
        <div className="propulsion-hardware-grid">
          <div className="propulsion-hardware-card">
            <MotorSelect
              motors={motorSamples}
              selectedMotor={selectedMotor}
              onChange={(selectedMotorId) => onPropulsionStateChange({ ...propulsionState, selectedMotorId })}
            />
            <div className="propulsion-readouts">
              <PropulsionMetricTile label="Kv" value={`${selectedMotor.kvRpmV} rpm/V`} />
              <PropulsionMetricTile label="Continuous power" value={formatWatts(selectedMotor.continuousPowerW)} />
              <PropulsionMetricTile label="Max current" value={`${selectedMotor.maxCurrentA} A`} />
            </div>
          </div>
          <div className="propulsion-hardware-card">
            <PropellerSelect
              propellers={propellerSamples}
              selectedPropeller={selectedPropeller}
              onChange={(selectedPropellerId) => onPropulsionStateChange({ ...propulsionState, selectedPropellerId })}
            />
            <div className="propulsion-readouts">
              <PropulsionMetricTile label="Diameter" value={formatInchesAsMm(selectedPropeller.diameterIn)} />
              <PropulsionMetricTile label="Pitch" value={formatInchesAsMm(selectedPropeller.pitchIn)} />
              <PropulsionMetricTile label="Static thrust" value={`${selectedPropeller.staticThrustN.toFixed(1)} N @ ${selectedPropeller.staticRpm}`} />
              <PropulsionMetricTile label="Prop data source" value={isEstimatedPropellerData ? "estimate" : "measured"} />
              <PropulsionMetricTile label="Cruise peak efficiency" value={`${(selectedPropeller.peakEfficiency * 100).toFixed(1)}%`} />
            </div>
          </div>
          <div className="propulsion-hardware-card">
            <BatterySelect
              batteries={batterySamples}
              selectedBattery={selectedBattery}
              onChange={(selectedBatteryId) => onPropulsionStateChange({ ...propulsionState, selectedBatteryId })}
            />
            <div className="propulsion-readouts">
              <PropulsionMetricTile label="Voltage" value={`${(batteryInputs.cells * 3.7).toFixed(1)} V`} />
              <PropulsionMetricTile label="Capacity" value={`${selectedBattery.capacityAh.toFixed(1)} Ah`} />
              <PropulsionMetricTile label="C rating" value={`${selectedBattery.cRating}C`} />
              <PropulsionMetricTile label="Pack mass" value={`${selectedBattery.massKg.toFixed(2)} kg`} />
            </div>
          </div>
        </div>
      </section>

      <section className="propulsion-panel propulsion-results-panel">
        <div className="propulsion-title">
          <Ruler size={20} />
          <h2>Computed Fit</h2>
        </div>
        <div className="propulsion-result-groups">
          <ResultGroup title="Thrust">
            <PropulsionMetric label="Takeoff thrust / weight" note={takeoffThrustVerdict.text} noteTone={takeoffThrustVerdict.tone} value={`${result.adjustedTakeoffThrustToWeight.toFixed(2)}`} />
            <PropulsionMetric label="Adjusted takeoff thrust" value={`${result.adjustedTakeoffThrustTotalN.toFixed(1)} N (${result.adjustedTakeoffThrustTotalKgf.toFixed(2)} kgf)`} />
            <PropulsionMetric label="Per motor" value={`${result.thrustPerMotorN.toFixed(1)} N`} />
            <PropulsionMetric label="Hover thrust / motor" value={`${result.requiredHoverThrustPerMotorN.toFixed(1)} N`} />
          </ResultGroup>
          <ResultGroup title="Propeller">
            <PropulsionMetric label="Disk area / rotor" value={`${result.diskAreaPerRotorM2.toFixed(3)} m2`} />
            <PropulsionMetric label="Disk loading" value={`${result.effectiveDiskLoadingNpm2.toFixed(1)} N/m2`} />
            <PropulsionMetric label="Operating RPM" value={`${result.motorLoadedRpm.toFixed(0)}`} />
            <PropulsionMetric label="Pitch speed" value={`${formatSpeedKt(result.pitchSpeedMS)}`} />
            <PropulsionMetric label="Cruise driver" value={cruiseDriver} />
            <PropulsionMetric label="Prop speed margin" note={propSpeedVerdict.text} noteTone={propSpeedVerdict.tone} value={propSpeedMargin > 0 ? `${propSpeedMargin.toFixed(2)}x` : "not available"} />
            <PropulsionMetric label="Hover efficiency" note="static rotor estimate" value={`${(result.hoverPropEfficiency * 100).toFixed(1)}%`} />
            <PropulsionMetric label="Cruise efficiency" note="forward-flight estimate" value={`${(result.cruisePropEfficiency * 100).toFixed(1)}%`} />
          </ResultGroup>
          <ResultGroup title="Electrical">
            <PropulsionMetric label="Peak demand / motor" value={formatWatts(propulsionDemand.peakElectricalPowerW / rotorCount)} />
            <PropulsionMetric label="Motor power margin" note={ratioVerdict(motorPowerMargin, 1.5, 1.2).text} noteTone={ratioVerdict(motorPowerMargin, 1.5, 1.2).tone} value={`${motorPowerMargin.toFixed(2)}x`} />
            <PropulsionMetric label="Max prop power / motor" value={formatWatts(result.powerPerMotorW)} />
            <PropulsionMetric label="Total available shaft" value={formatWatts(result.totalPowerW)} />
            <PropulsionMetric label="Max prop current / motor" value={`${result.currentPerMotorA.toFixed(1)} A`} />
            <PropulsionMetric label="ESC rating" note={escVerdict.text} noteTone={escVerdict.tone} value={`${escRatingA.toFixed(0)} A`} />
          </ResultGroup>
          <ResultGroup title="Battery">
            <PropulsionMetric label="Battery max current" note={ratioVerdict(batteryCurrentMargin, 1.3, 1.05).text} noteTone={ratioVerdict(batteryCurrentMargin, 1.3, 1.05).tone} value={`${result.batteryMaxCurrentA.toFixed(0)} A`} />
            <PropulsionMetric label="Required takeoff current" value={`${selectedTakeoffCurrentA.toFixed(1)} A`} />
            <PropulsionMetric label="Peak mission current" value={`${selectedPeakCurrentA.toFixed(1)} A`} />
            <PropulsionMetric label="Max pack current used" value={`${result.takeoffCurrentA.toFixed(1)} A`} />
            <PropulsionMetric label="Cruise current" value={`${(propulsionDemand.cruisePowerW / Math.max(selectedBatteryVoltage, 1)).toFixed(1)} A`} />
            <PropulsionMetric label="Usable energy after reserve" value={`${selectedUsableEnergyWh.toFixed(0)} Wh`} />
            <PropulsionMetric label="Takeoff energy" value={`${missionTakeoffEnergyWh.toFixed(0)} Wh`} />
            <PropulsionMetric label="Cruise energy left" value={`${selectedCruiseEnergyWh.toFixed(0)} Wh`} />
            <PropulsionMetric label="Mission endurance" note={ratioVerdict(selectedMissionEnduranceMin / Math.max(sizingProject.mission.enduranceMin, 1), 1.15, 1).text} noteTone={ratioVerdict(selectedMissionEnduranceMin / Math.max(sizingProject.mission.enduranceMin, 1), 1.15, 1).tone} value={`${selectedMissionEnduranceMin.toFixed(1)} min`} />
          </ResultGroup>
        </div>
        <p className="propulsion-note">
          Propeller samples use APC performance files for diameter, pitch, static thrust, static power, and cruise peak efficiency.
          Hover efficiency is estimated from disk loading and static power; cruise efficiency is estimated around the propeller forward-flight peak.
          Mission endurance uses the sizing mission: selected battery energy after reserve, minus takeoff energy, then remaining cruise energy divided by cruise power.
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
      <PropulsionFieldLabel label="Motor" />
      <div>
        <select value={selectedMotor.id} onChange={(event) => onChange(event.target.value)}>
          {motorPowerGroups.filter((group) => motors.some(group.includes)).map((group) => (
            <optgroup key={group.label} label={group.label}>
              {motors.filter(group.includes).map((motor) => (
                <option key={motor.id} value={motor.id}>
                  {motor.name} - {formatWattsAsKw(motor.continuousPowerW)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <small>
        {selectedMotor.kvRpmV} Kv, {formatWatts(selectedMotor.continuousPowerW)} continuous, {selectedMotor.maxCurrentA} A max
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
      <PropulsionFieldLabel label="Battery" />
      <div>
        <select value={selectedBattery.id} onChange={(event) => onChange(event.target.value)}>
          {batteryMassGroups.filter((group) => batteries.some(group.includes)).map((group) => (
            <optgroup key={group.label} label={group.label}>
              {batteries.filter(group.includes).map((battery) => (
                <option key={battery.id} value={battery.id}>
                  {battery.name} - {battery.massKg.toFixed(1)} kg
                </option>
              ))}
            </optgroup>
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
      <PropulsionFieldLabel label="Propeller" />
      <div>
        <select value={selectedPropeller.id} onChange={(event) => onChange(event.target.value)}>
          {propellerDiameterGroups.filter((group) => propellers.some(group.includes)).map((group) => (
            <optgroup key={group.label} label={group.label}>
              {propellers.filter(group.includes).map((propeller) => (
                <option key={propeller.id} value={propeller.id}>
                  {propeller.name} - {propeller.diameterIn.toFixed(0)}x{propeller.pitchIn.toFixed(0)} in, pitch {formatInchesAsMm(propeller.pitchIn)}
                </option>
              ))}
            </optgroup>
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

function formatInchesAsMeters(valueIn: number) {
  return `${(valueIn * 0.0254).toFixed(2)} m`;
}

const motorPowerGroups = [
  { label: "<1 kW", includes: (motor: MotorSample) => motor.continuousPowerW < 1000 },
  { label: "1-10 kW", includes: (motor: MotorSample) => motor.continuousPowerW >= 1000 && motor.continuousPowerW < 10000 },
  { label: "10+ kW", includes: (motor: MotorSample) => motor.continuousPowerW >= 10000 },
];

const propellerDiameterGroups = [
  { label: "<10 in diameter", includes: (propeller: PropellerSample) => propeller.diameterIn < 10 },
  { label: "10-50 in diameter", includes: (propeller: PropellerSample) => propeller.diameterIn >= 10 && propeller.diameterIn < 50 },
  { label: "50+ in diameter", includes: (propeller: PropellerSample) => propeller.diameterIn >= 50 },
];

const batteryMassGroups = [
  { label: "<1 kg", includes: (battery: BatterySample) => battery.massKg < 1 },
  { label: "1-10 kg", includes: (battery: BatterySample) => battery.massKg >= 1 && battery.massKg < 10 },
  { label: "10+ kg", includes: (battery: BatterySample) => battery.massKg >= 10 },
];

function formatWattsAsKw(valueW: number) {
  return `${(valueW / 1000).toFixed(valueW >= 10000 ? 0 : 1)} kW`;
}

export function formatMetersAsMm(valueM: number) {
  return valueM > 0 ? `${(valueM * 1000).toFixed(0)} mm` : "not set";
}

type Tone = "good" | "caution" | "bad" | "neutral";

function propulsionDemandFromAircraft({
  aircraftCompute,
  aircraftMassKg,
  cruisePropEfficiency,
  loadedRpm,
  missionEnduranceMin,
  missionReservePct,
  missionTakeoffMin,
  pitchSpeedMS,
  propeller,
  rotorCount,
  targetThrustToWeight,
}: {
  aircraftCompute: ReturnType<typeof computeSketchAerodynamics> | undefined;
  aircraftMassKg: number;
  cruisePropEfficiency: number;
  loadedRpm: number;
  missionEnduranceMin: number;
  missionReservePct: number;
  missionTakeoffMin: number;
  pitchSpeedMS: number;
  propeller: PropellerSample;
  rotorCount: number;
  targetThrustToWeight: number;
}) {
  const cruise = cruiseDemandFromAero({ aircraftCompute, aircraftMassKg, cruisePropEfficiency, loadedRpm, pitchSpeedMS, propeller });
  const cruisePowerW = cruise.powerW;
  const hoverPowerW = Math.max(aircraftCompute?.propulsion.hoverPowerTotalW ?? 0, aircraftMassKg * 9.80665 * 10);
  const takeoffElectricalPowerW = hoverPowerW * Math.pow(Math.max(targetThrustToWeight, 1), 1.5);
  const peakElectricalPowerW = Math.max(takeoffElectricalPowerW, cruisePowerW);
  const missionEnergyWh = takeoffElectricalPowerW * (Math.max(missionTakeoffMin, 0) / 60) + cruisePowerW * (Math.max(missionEnduranceMin, 1) / 60);
  const requiredEnergyWh = installedEnergyForMissionWh(missionEnergyWh, missionReservePct);
  return {
    cruisePowerW,
    bestCruiseSpeedMS: cruise.speedMS,
    cruiseLiftToDrag: cruise.liftToDrag,
    cruisePropEfficiency: cruise.propEfficiency,
    hoverPowerW,
    peakElectricalPowerW,
    requiredEnergyWh,
    takeoffElectricalPowerW,
  };
}

function cruiseDemandFromAero({
  aircraftCompute,
  aircraftMassKg,
  cruisePropEfficiency,
  loadedRpm,
  pitchSpeedMS,
  propeller,
}: {
  aircraftCompute: ReturnType<typeof computeSketchAerodynamics> | undefined;
  aircraftMassKg: number;
  cruisePropEfficiency: number;
  loadedRpm: number;
  pitchSpeedMS: number;
  propeller: PropellerSample;
}) {
  const loadedRpmRatio = propeller.peakEfficiencyRpm > 0 && loadedRpm > 0 ? loadedRpm / propeller.peakEfficiencyRpm : 1;
  const loadedPeakEfficiencySpeedMS = Math.max(propeller.peakEfficiencyMph * 0.44704 * loadedRpmRatio, 1);
  const pitchLimitedSpeedMS = pitchSpeedMS > 0 ? Math.max(pitchSpeedMS * 0.95, 1) : loadedPeakEfficiencySpeedMS;
  const propLimitedSpeedMS = Math.max(Math.min(loadedPeakEfficiencySpeedMS, pitchLimitedSpeedMS), 1);
  if (!aircraftCompute?.validity.drag || !aircraftCompute.validity.lift) {
    return {
      liftToDrag: aircraftCompute?.aerodynamics.liftToDrag ?? 0,
      powerW: Math.max(aircraftCompute?.aerodynamics.cruisePowerW ?? 0, 0),
      propEfficiency: cruisePropEfficiency,
      speedMS: propLimitedSpeedMS,
    };
  }
  const rhoKgM3 = aircraftCompute.assumptions.rhoKgM3;
  const wingAreaM2 = Math.max(aircraftCompute.geometry.wingAreaM2, 0.001);
  const aspectRatio = Math.max(aircraftCompute.geometry.aspectRatio, 0.1);
  const oswaldEfficiency = Math.max(aircraftCompute.assumptions.oswaldEfficiency, 0.1);
  const parasiteCd = Math.max(aircraftCompute.aerodynamics.parasiteDragCoefficient, 0.001);
  const stallSpeedMS = Math.max(aircraftCompute.aerodynamics.stallSpeedMS, 0);
  const weightN = Math.max(aircraftMassKg, 0.001) * 9.80665;
  const minCruiseSpeedMS = Math.max(stallSpeedMS * 1.2, 1);
  const maxCruiseSpeedMS = Math.max(propLimitedSpeedMS, minCruiseSpeedMS);
  const sampleCount = 30;
  let best = cruisePowerAtSpeed({
    aircraftCompute,
    aspectRatio,
    cruisePropEfficiency,
    loadedPeakEfficiencySpeedMS,
    oswaldEfficiency,
    parasiteCd,
    rhoKgM3,
    speedMS: minCruiseSpeedMS,
    weightN,
    wingAreaM2,
  });
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = sampleCount > 0 ? index / sampleCount : 0;
    const speedMS = minCruiseSpeedMS + (maxCruiseSpeedMS - minCruiseSpeedMS) * t;
    const candidate = cruisePowerAtSpeed({
      aircraftCompute,
      aspectRatio,
      cruisePropEfficiency,
      loadedPeakEfficiencySpeedMS,
      oswaldEfficiency,
      parasiteCd,
      rhoKgM3,
      speedMS,
      weightN,
      wingAreaM2,
    });
    if (candidate.powerW < best.powerW) best = candidate;
  }
  return best;
}

function cruisePowerAtSpeed({
  aircraftCompute,
  aspectRatio,
  cruisePropEfficiency,
  loadedPeakEfficiencySpeedMS,
  oswaldEfficiency,
  parasiteCd,
  rhoKgM3,
  speedMS,
  weightN,
  wingAreaM2,
}: {
  aircraftCompute: ReturnType<typeof computeSketchAerodynamics>;
  aspectRatio: number;
  cruisePropEfficiency: number;
  loadedPeakEfficiencySpeedMS: number;
  oswaldEfficiency: number;
  parasiteCd: number;
  rhoKgM3: number;
  speedMS: number;
  weightN: number;
  wingAreaM2: number;
}) {
  const dynamicPressurePa = 0.5 * rhoKgM3 * speedMS * speedMS;
  const cl = weightN / Math.max(dynamicPressurePa * wingAreaM2, 0.001);
  const inducedCd = (cl * cl) / (Math.PI * aspectRatio * oswaldEfficiency);
  const cd = parasiteCd + inducedCd;
  const dragN = dynamicPressurePa * aircraftCompute.geometry.dragReferenceAreaM2 * cd;
  const speedMismatch = loadedPeakEfficiencySpeedMS > 0 ? Math.abs(speedMS - loadedPeakEfficiencySpeedMS) / loadedPeakEfficiencySpeedMS : 0;
  const speedEfficiencyPenalty = 1 - Math.min(0.45, speedMismatch * 0.45);
  const propEfficiency = Math.max(0.18, Math.min(0.9, cruisePropEfficiency * speedEfficiencyPenalty));
  return {
    liftToDrag: cd > 0 ? cl / cd : 0,
    powerW: (dragN * speedMS) / propEfficiency,
    propEfficiency,
    speedMS,
  };
}

function rankedPropulsionCombos({
  aircraftCompute,
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  bladeCount,
  rotorDefinition,
  rotorCount,
  targetEnduranceMin,
  targetThrustToWeight,
}: {
  aircraftCompute: ReturnType<typeof computeSketchAerodynamics> | undefined;
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  bladeCount: number;
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
          const demand = propulsionDemandFromAircraft({
            aircraftCompute,
            aircraftMassKg,
            cruisePropEfficiency: result.cruisePropEfficiency,
            loadedRpm: result.motorLoadedRpm,
            missionEnduranceMin: targetEnduranceMin,
            missionReservePct: 0,
            missionTakeoffMin: 0,
            pitchSpeedMS: result.pitchSpeedMS,
            propeller,
            rotorCount,
            targetThrustToWeight,
          });
          const propDiameterM = propeller.diameterIn * 0.0254;
          const diameterFit = rotorDefinition.diameterM <= 0 || propDiameterM <= rotorDefinition.diameterM * 1.04;
          const thrustRatio = result.availableThrustToWeight / Math.max(targetThrustToWeight, 0.1);
          const motorPowerRatio = (motor.continuousPowerW * rotorCount) / Math.max(demand.peakElectricalPowerW, result.totalPowerW, 1);
          const energyRatio = (battery.cells * 3.7 * battery.capacityAh) / Math.max(demand.requiredEnergyWh, 1);
          const demandCurrentA = demand.peakElectricalPowerW / Math.max(battery.cells * 3.7, 1);
          const currentRatio = (battery.capacityAh * battery.cRating) / Math.max(demandCurrentA, result.takeoffCurrentA, 1);
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
          return { battery, caution, currentRatio, energyRatio, motor, pass, propeller, result, score, summary, thrustRatio };
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
  if (value >= 0.995) return { text: "at limit", tone: "caution" };
  return { text: "undersized", tone: "bad" };
}

function formatWatts(value: number) {
  if (!Number.isFinite(value)) return "--";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kW` : `${value.toFixed(0)} W`;
}

function formatSpeedKt(valueMS: number) {
  if (!Number.isFinite(valueMS)) return "--";
  return `${(valueMS / metersPerSecondPerKnot).toFixed(1)} kt`;
}

export function PropulsionNumberField({
  info,
  label,
  suffix,
  step,
  value,
  onChange,
}: {
  info?: string;
  label: string;
  suffix?: string;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const resolvedInfo = info ?? propulsionInfoFor(label);
  return (
    <label className="propulsion-field">
      <span className={`field-label ${resolvedInfo ? "has-info" : ""}`}>
        {label}
        {resolvedInfo ? <span className="field-tooltip">{resolvedInfo}</span> : null}
      </span>
      <div>
        <input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}
