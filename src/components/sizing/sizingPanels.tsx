import { Battery, Plane, Ruler, Scale, Settings2, Wind, Zap } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { auditedSizingAssumptions, computeSizingAnalysis } from "../../sizing/auditedSizingEngine";
import { fixedAircraftFinCount, fixedAircraftMotorCount, fixedAircraftTailplaneCount, metersPerSecondPerKnot } from "../../app/constants";
import type { SizingProject } from "../../sizing";
import { Metric } from "../ui/Metric";
import { PropulsionNumberField } from "../propulsion/fields";


export function SizingDashboard({
  analysis,
  project,
  onProjectChange,
}: {
  analysis?: ReturnType<typeof computeSizingAnalysis>;
  project: SizingProject;
  onProjectChange: (next: SizingProject) => void;
}) {
  const computedDraft = useMemo(() => computeSizingDraft(project), [project]);
  const hardwarePick = computedDraft?.hardware ?? null;
  const targetLengthM = computedDraft.totalWidthM * clampNumber(project.mission.lengthRatio, 0.45, 2);
  const actualLengthRatio = computedDraft.totalLengthM / Math.max(computedDraft.totalWidthM, 0.01);
  const lengthConstraint = computedDraft.totalLengthM > targetLengthM + 0.01 ? "Minimum tail arm" : "Target ratio";
  function updateMission(patch: Partial<SizingProject["mission"]>) {
    const nextProject = { ...project, mission: { ...project.mission, ...patch } };
    onProjectChange(nextProject);
  }
  return (
    <main className="sizing-dashboard">
      <section className="sizing-dashboard-panel sizing-dashboard-requirements">
        <PanelTitle icon={<Settings2 size={16} />} title="Mission Inputs" />
        <p className="dashboard-muted">Electric VTOL, 2 rotors, 2 motors, dual empennage surfaces in rotor wake.</p>
        <div className="sizing-input-grid">
          <PropulsionNumberField
            label="Payload"
            suffix="kg"
            step={0.1}
            value={project.mission.payloadKg}
            onChange={(payloadKg) => updateMission({ payloadKg: Math.max(0, payloadKg) })}
          />
          <PropulsionNumberField
            label="Takeoff T/W"
            step={0.1}
            value={project.mission.takeoffThrustToWeight}
            onChange={(takeoffThrustToWeight) => updateMission({ takeoffThrustToWeight: Math.max(0.1, takeoffThrustToWeight) })}
          />
          <PropulsionNumberField
            label="Cruise speed"
            suffix="kt"
            step={1}
            value={roundInputValue(msToKnots(project.mission.cruiseSpeedMS))}
            onChange={(cruiseSpeedKt) => updateMission({ cruiseSpeedMS: Math.max(1, knotsToMS(cruiseSpeedKt)) })}
          />
          <PropulsionNumberField
            label="Target cruise CL"
            step={0.05}
            value={project.mission.cruiseLiftCoefficient}
            onChange={(cruiseLiftCoefficient) => updateMission({ cruiseLiftCoefficient: clampNumber(cruiseLiftCoefficient, 0.25, 1.4) })}
          />
          <PropulsionNumberField
            label="Aspect ratio"
            step={0.1}
            value={project.mission.aspectRatio}
            onChange={(aspectRatio) => updateMission({ aspectRatio: Math.min(12, Math.max(2.2, aspectRatio)) })}
          />
          <PropulsionNumberField
            label="Length ratio"
            step={0.05}
            value={project.mission.lengthRatio}
            onChange={(lengthRatio) => updateMission({ lengthRatio: Math.min(2, Math.max(0.45, lengthRatio)) })}
          />
          <PropulsionNumberField
            label="Endurance"
            suffix="min"
            step={1}
            value={project.mission.enduranceMin}
            onChange={(enduranceMin) => updateMission({ enduranceMin: Math.max(1, enduranceMin) })}
          />
          <PropulsionNumberField
            label="Hover allowance"
            suffix="min"
            step={0.5}
            value={project.mission.hoverTimeMin}
            onChange={(hoverTimeMin) => updateMission({ hoverTimeMin: Math.max(0, hoverTimeMin) })}
          />
          <PropulsionNumberField
            label="Reserve"
            suffix="%"
            step={5}
            value={project.mission.reservePct}
            onChange={(reservePct) => updateMission({ reservePct: Math.max(0, reservePct) })}
          />
          <label className="propulsion-field">
            <span>Rotor blades</span>
            <div>
              <select
                value={project.mission.rotorBladeCount}
                onChange={(event) => updateMission({ rotorBladeCount: normalizeSizingRotorBladeCount(Number(event.target.value)) })}
              >
                <option value={2}>2 blades</option>
                <option value={3}>3 blades</option>
                <option value={4}>4 blades</option>
              </select>
            </div>
          </label>
        </div>
      </section>
      <section className="sizing-dashboard-panel sizing-dashboard-summary sizing-result-strip">
        <PanelTitle icon={<Plane size={16} />} title="Sizing Result" />
        <div className="sizing-summary-grid">
          <Metric label="Estimated mass" value={`${computedDraft.massKg.toFixed(2)} kg`} />
          <Metric label="Sized takeoff mass" value={`${computedDraft.massKg.toFixed(2)} kg`} />
          <Metric label="Wing area" value={`${computedDraft.wingAreaM2.toFixed(3)} m2`} />
          <Metric label="Battery mass" value={`${computedDraft.batteryMassKg.toFixed(2)} kg`} />
          <Metric label="Rotor diameter" value={`${(computedDraft.rotorDiameterM * 1000).toFixed(0)} mm`} />
        </div>
      </section>
      <section className="sizing-dashboard-panel sizing-dashboard-data">
            <SizingDataGroup icon={<Scale size={15} />} title="Mass Build-Up">
              <Metric label="Structure" value={`${computedDraft.structureMassKg.toFixed(2)} kg`} />
              <Metric label="Total motor mass" value={`${computedDraft.motorMassKg.toFixed(2)} kg`} />
              <Metric label="Rotor mass" value={`${computedDraft.rotorMassKg.toFixed(2)} kg`} />
              <Metric label="Battery mass" value={`${computedDraft.batteryMassKg.toFixed(2)} kg`} />
              <Metric label="Electronics" value={`${computedDraft.electronicsMassKg.toFixed(2)} kg`} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Battery size={15} />} title="Battery & Energy">
              <Metric label="Mission energy" value={`${computedDraft.batteryEnergyWh.toFixed(0)} Wh`} />
              <Metric label="Sized usable energy" value={`${computedDraft.batteryEnergyAvailableWh.toFixed(0)} Wh`} />
              <Metric label="Flight target" value={`${project.mission.enduranceMin.toFixed(0)} min + ${project.mission.hoverTimeMin.toFixed(0)} min takeoff`} />
              <Metric label="Reserve" value={`${project.mission.reservePct.toFixed(0)}% included`} />
              <Metric label="Battery L x W" value={`${(computedDraft.batteryEnvelope.lengthM * 1000).toFixed(0)} x ${(computedDraft.batteryEnvelope.widthM * 1000).toFixed(0)} mm`} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Ruler size={15} />} title="Planform Geometry">
              <Metric label="Total length" value={`${computedDraft.totalLengthM.toFixed(2)} m`} />
              <Metric label="Target length" value={`${targetLengthM.toFixed(2)} m`} />
              <Metric label="Actual L/span" value={`${actualLengthRatio.toFixed(2)}`} />
              <Metric label="Length driver" value={lengthConstraint} />
              <Metric label="Wingspan" value={`${computedDraft.wingSpanM.toFixed(2)} m`} />
              <Metric label="Fuselage L x W" value={`${(computedDraft.fuselageLengthM * 1000).toFixed(0)} x ${(computedDraft.fuselageWidthM * 1000).toFixed(0)} mm`} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Wind size={15} />} title="Wing & Aero">
              <Metric label="Wing area" value={`${computedDraft.wingAreaM2.toFixed(3)} m2`} />
              <Metric label="Wing chord" value={`${computedDraft.meanChordM.toFixed(3)} m`} />
              <Metric label="Wing root depth" value={`${computedDraft.wingRootDepthM.toFixed(2)} m from nose`} />
              <Metric label="Suggested aerofoil" value={computedDraft.wingAirfoil} />
              <Metric label="Design cruise CL" value={`${computedDraft.cruiseLiftCoefficient.toFixed(2)}`} />
              <Metric label="Wing loading" value={`${computedDraft.wingLoadingKgM2.toFixed(1)} kg/m2`} />
              <Metric label="Stall speed" value={`${msToKnots(computedDraft.stallSpeedMS).toFixed(0)} kt`} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Ruler size={15} />} title="Tail Surfaces">
              <Metric label="Tail aerofoil" value={computedDraft.tailAirfoil} />
              <Metric label="Fin aerofoil" value={computedDraft.finAirfoil} />
              <Metric label="Tail area total" value={`${computedDraft.tailAreaM2.toFixed(3)} m2`} />
              <Metric label="Tail area / tailplane" value={`${computedDraft.tailAreaPerEmpennageM2.toFixed(3)} m2`} />
              <Metric label="Tail arm" value={`${computedDraft.tailArmM.toFixed(2)} m`} />
              <Metric label="Vertical fins" value={`${fixedAircraftFinCount}`} />
              <Metric label="Fin area / fin" value={`${computedDraft.finAreaPerFinM2.toFixed(3)} m2`} />
              <Metric label="Fin height x chord" value={`${computedDraft.finHeightM.toFixed(2)} m x ${computedDraft.finChordM.toFixed(2)} m`} />
              <Metric label="Tail volume ratio" value={`${computedDraft.tailVolumeRatio.toFixed(2)} unitless`} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Zap size={15} />} title="Power & Propulsion">
              <Metric label="Hover power" value={`${formatPower(computedDraft.hoverPowerTotalW)} total`} />
              <Metric label="Takeoff power" value={`${formatPower(computedDraft.takeoffPowerTotalW)} total`} />
              <Metric label="Cruise power" value={formatPower(computedDraft.cruisePowerW)} />
              <Metric label="Hover motor power" value={`${formatPower(computedDraft.powerPerMotorW)} each`} />
              <Metric label="Rotor blades" value={`${computedDraft.rotorBladeCount}`} />
              <Metric label="Rotor diameter" value={`${(computedDraft.rotorDiameterM * 1000).toFixed(0)} mm actual`} />
              <Metric label="Disk loading" value={`${computedDraft.actualDiskLoadingNpm2.toFixed(0)} N/m2 actual`} />
              {hardwarePick ? (
                <>
                  <Metric label="Motor diameter" value={`${(hardwarePick.motor.diameterM * 1000).toFixed(0)} mm`} />
                  <Metric label="Motor length" value={`${(hardwarePick.motor.lengthM * 1000).toFixed(0)} mm`} />
                  <Metric label="Mass / motor" value={`${hardwarePick.motor.massKg.toFixed(2)} kg each`} />
                </>
              ) : null}
            </SizingDataGroup>
      </section>
    </main>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="sizing-panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function SizingDataGroup({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <div className="sizing-data-group">
      <div className="sizing-data-heading">
        {icon}
        <h3>{title}</h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

type HardwareMotor = {
  diameterM: number;
  dimensionsMm: string;
  lengthM: number;
  massKg: number;
  maxThrustKg: number;
  name: string;
  source: string;
};

type HardwareRotor = {
  bladeMassKg: number;
  diameterIn: number;
  dimensionsMm: string;
  name: string;
  pitchIn: number;
  source: string;
};

type HardwareBattery = {
  dimensionsMm: string;
  energyWh: number;
  heightM: number;
  lengthM: number;
  massKg: number;
  name: string;
  source: string;
  widthM: number;
};

const actualHardwarePairs: Array<{ motor: HardwareMotor; rotor: HardwareRotor }> = [
  {
    motor: {
      diameterM: 0.1,
      dimensionsMm: "100 x 60 mm",
      lengthM: 0.06,
      massKg: 0.975,
      maxThrustKg: 28.7,
      name: "T-Motor U13II KV65",
      source: "T-Motor U13II KV65 datasheet",
    },
    rotor: {
      bladeMassKg: 0.107,
      diameterIn: 32,
      dimensionsMm: "32 x 11 in",
      name: "T-Motor G32x11 CF",
      pitchIn: 11,
      source: "T-Motor G32x11 datasheet",
    },
  },
  {
    motor: {
      diameterM: 0.1475,
      dimensionsMm: "147.5 x 55 mm",
      lengthM: 0.055,
      massKg: 1.74,
      maxThrustKg: 36.5,
      name: "T-Motor U15II KV80",
      source: "T-Motor U15II KV80 datasheet",
    },
    rotor: {
      bladeMassKg: 0.237,
      diameterIn: 40,
      dimensionsMm: "40 x 13.1 in",
      name: "T-Motor G40x13.1 CF",
      pitchIn: 13.1,
      source: "T-Motor G40x13.1 datasheet",
    },
  },
];

const actualBatteryPicks: HardwareBattery[] = [
  {
    dimensionsMm: "182 x 67 x 115 mm",
    energyWh: 444,
    heightM: 0.115,
    lengthM: 0.182,
    massKg: 2.8,
    name: "Tattu 12S 10Ah 30C",
    source: "Tattu 12S LiPo series datasheet",
    widthM: 0.067,
  },
  {
    dimensionsMm: "191 x 78 x 130 mm",
    energyWh: 710.4,
    heightM: 0.13,
    lengthM: 0.191,
    massKg: 4.0,
    name: "Tattu 12S 16Ah 30C",
    source: "Tattu 12S LiPo series datasheet",
    widthM: 0.078,
  },
  {
    dimensionsMm: "206 x 93 x 119 mm",
    energyWh: 976.8,
    heightM: 0.119,
    lengthM: 0.206,
    massKg: 4.65,
    name: "Tattu 12S 22Ah 30C",
    source: "Tattu 12S LiPo series datasheet",
    widthM: 0.093,
  },
];

function selectActualHardwareFor({
  energyRequiredWh,
  idealRotorDiameterM,
  powerPerMotorW,
  rotorBladeCount,
  takeoffTargetKg,
}: {
  energyRequiredWh: number;
  idealRotorDiameterM?: number;
  powerPerMotorW?: number;
  rotorBladeCount: number;
  takeoffTargetKg: number;
}) {
  const bladeCount = normalizeSizingRotorBladeCount(rotorBladeCount);
  const thrustTargetKg = Math.max(takeoffTargetKg * 1.2, takeoffTargetKg + 0.5);
  const pair = actualHardwarePairs.find((candidate) => candidate.motor.maxThrustKg >= thrustTargetKg) ?? actualHardwarePairs[actualHardwarePairs.length - 1];
  const powerSizedMassKg = (powerPerMotorW ?? 0) / catalogueMotorPowerDensityWKg;
  const motorMassKg = Math.max(pair.motor.massKg, powerSizedMassKg, thrustTargetKg * 0.012);
  const motorScale = Math.cbrt(motorMassKg / Math.max(pair.motor.massKg, 0.01));
  const motorDiameterM = pair.motor.diameterM * motorScale;
  const motorLengthM = pair.motor.lengthM * motorScale;
  const motor: HardwareMotor = {
    ...pair.motor,
    diameterM: motorDiameterM,
    dimensionsMm: `${(motorDiameterM * 1000).toFixed(0)} x ${(motorLengthM * 1000).toFixed(0)} mm est.`,
    lengthM: motorLengthM,
    massKg: motorMassKg,
    maxThrustKg: thrustTargetKg,
    name: pair.motor.name,
    source: `${pair.motor.source}; scaled only if power demand exceeds catalogue envelope`,
  };
  const lowDiskDiameterM = Math.max(idealRotorDiameterM ?? pair.rotor.diameterIn * 0.0254, 0.25);
  const bladeCountDiameterScale = Math.pow(baselineRotorBladeCount / bladeCount, propDiameterThrustExponent);
  const rotorDiameterM = lowDiskDiameterM * bladeCountDiameterScale;
  const rotorDiameterIn = rotorDiameterM / 0.0254;
  const rotorPitchIn = Math.max(4, rotorDiameterIn * 0.32);
  const referenceRotor = pair.rotor;
  const rotorMassPerAssemblyKg = Math.max(0.08, referenceRotor.bladeMassKg * Math.pow(rotorDiameterIn / referenceRotor.diameterIn, propMassDiameterExponent) * bladeCount);
  const rotorBladeMassKg = rotorMassPerAssemblyKg / bladeCount;
  const rotor: HardwareRotor = {
    bladeMassKg: rotorBladeMassKg,
    diameterIn: rotorDiameterIn,
    dimensionsMm: `${rotorDiameterIn.toFixed(1)} x ${rotorPitchIn.toFixed(1)} in est.`,
    name: `${bladeCount}-blade indicative carbon prop`,
    pitchIn: rotorPitchIn,
    source: `${referenceRotor.source}; diameter estimated from disk loading and blade count`,
  };
  const energyTargetWh = energyRequiredWh * batterySelectionMargin;
  const battery = actualBatteryPicks.find((candidate) => candidate.energyWh >= energyTargetWh) ?? actualBatteryPicks[actualBatteryPicks.length - 1];
  return {
    battery,
    motor,
    rotor,
    rotorMassPerAssemblyKg,
    sources: [motor.source, rotor.source, battery.source],
    totalHardwareMassKg: motor.massKg * fixedAircraftMotorCount + rotorMassPerAssemblyKg * fixedAircraftMotorCount + battery.massKg,
  };
}

const batterySelectionMargin = 1.2;
const baselineRotorBladeCount = 2;
const propDiameterThrustExponent = 0.25;
const catalogueMotorPowerDensityWKg = 5200;
const propMassDiameterExponent = 2.15;

function scaledBatteryEnvelope(referenceBattery: HardwareBattery, targetMassKg: number) {
  const massKg = Math.max(targetMassKg, 0.01);
  const targetVolumeM3 = massKg / auditedSizingAssumptions.lipoPackDensityKgM3;
  const referenceAspect = Math.max(referenceBattery.lengthM / Math.max(referenceBattery.widthM, 0.001), 1);
  const widthM = Math.cbrt(targetVolumeM3 / Math.max(referenceAspect, 0.001));
  return {
    heightM: widthM,
    lengthM: widthM * referenceAspect,
    massKg,
    widthM,
  };
}

export function computeSizingDraft(project: SizingProject) {
  const payloadKg = Math.max(project.mission.payloadKg, 0.1);
  const motorCount = fixedAircraftMotorCount;
  const rotorBladeCount = normalizeSizingRotorBladeCount(project.mission.rotorBladeCount);
  const takeoffThrustToWeight = Math.max(project.mission.takeoffThrustToWeight, 0.1);
  const cruiseSpeedMS = Math.max(project.mission.cruiseSpeedMS, 1);
  const enduranceMin = Math.max(project.mission.enduranceMin, 1);
  const hoverTimeMin = Math.max(project.mission.hoverTimeMin, 0);
  const reserveFactor = 1 + Math.max(project.mission.reservePct, 0) / 100;
  const batteryEnergyDensityWhKg = Math.max(project.mission.batteryEnergyDensityWhKg, 1);
  const initialMassGuessKg = Math.max(payloadKg / 0.5, payloadKg + 2.5);
  const targetAspectRatio = clampNumber(numberOr(project.mission.aspectRatio, 2.8), 2.2, 12);
  const lengthRatio = clampNumber(numberOr(project.mission.lengthRatio, 0.8), 0.45, 2);
  const idealDiskLoadingNpm2 = bestGuessDiskLoadingNpm2({ cruiseSpeedMS, enduranceMin, hoverTimeMin });
  const cruiseLiftCoefficient = clampNumber(numberOr(project.mission.cruiseLiftCoefficient, bestGuessCruiseLiftCoefficient({ cruiseSpeedMS })), 0.25, 1.4);
  const wingAirfoil = suggestWingAirfoil({ cruiseLiftCoefficient, cruiseSpeedMS });
  const tailVolumeRatio = clampNumber(numberOr(project.mission.tailVolumeTarget, bestGuessTailVolumeTarget({ hoverTimeMin })), 0.25, 1.2);
  const rhoKgM3 = 1.225;
  const hoverFigureOfMerit = hoverFigureOfMeritForBladeCount(rotorBladeCount);
  const cruiseLiftToDrag = 8.2;
  const cruisePropulsiveEfficiency = 0.72;
  const maximumWingLoadingKgM2 = 34;
  const structureFraction = 0.25;
  const electronicsMassKg = 0.9;
  let massKg = initialMassGuessKg;
  let wingAreaM2 = 0.1;
  let wingSpanM = 0.1;
  let meanChordM = 0.1;
  let rotorDiameterM = 0.1;
  let idealRotorDiameterM = 0.1;
  let actualDiskLoadingNpm2 = 0;
  let hoverPowerTotalW = 0;
  let takeoffPowerTotalW = 0;
  let cruisePowerW = 0;
  let batteryEnergyWh = 0;
  let batteryMassKg = 0;
  let motorMassKg = 0;
  let rotorMassKg = 0;
  let structureMassKg = 0;
  let fuselageLengthM = 0.25;
  let fuselageWidthM = 0.12;
  let actualCruiseLiftCoefficient = cruiseLiftCoefficient;
  let hardware = selectActualHardwareFor({ energyRequiredWh: 0, rotorBladeCount, takeoffTargetKg: massKg * takeoffThrustToWeight / motorCount });
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const weightN = massKg * 9.80665;
    const liftSizedWingAreaM2 = weightN / Math.max(0.5 * rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS * cruiseLiftCoefficient, 1);
    wingAreaM2 = Math.max(liftSizedWingAreaM2, massKg / maximumWingLoadingKgM2);
    actualCruiseLiftCoefficient = weightN / Math.max(0.5 * rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS * wingAreaM2, 1);
    wingSpanM = Math.sqrt(wingAreaM2 * targetAspectRatio);
    meanChordM = wingAreaM2 / Math.max(wingSpanM, 0.01);
    const thrustPerMotorN = (weightN * takeoffThrustToWeight) / motorCount;
    idealRotorDiameterM = 2 * Math.sqrt(thrustPerMotorN / idealDiskLoadingNpm2 / Math.PI);
    hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, idealRotorDiameterM, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
    rotorDiameterM = hardware.rotor.diameterIn * 0.0254;
    const rotorDiskAreaPerMotorM2 = Math.PI * Math.pow(rotorDiameterM / 2, 2);
    const totalRotorDiskAreaM2 = motorCount * rotorDiskAreaPerMotorM2;
    actualDiskLoadingNpm2 = thrustPerMotorN / Math.max(rotorDiskAreaPerMotorM2, 0.001);
    hoverPowerTotalW = Math.pow(weightN, 1.5) / Math.sqrt(2 * rhoKgM3 * totalRotorDiskAreaM2) / hoverFigureOfMerit;
    takeoffPowerTotalW = hoverPowerTotalW * Math.pow(takeoffThrustToWeight, 1.5);
    cruisePowerW = (weightN / cruiseLiftToDrag) * cruiseSpeedMS / cruisePropulsiveEfficiency;
    batteryEnergyWh = (takeoffPowerTotalW * (hoverTimeMin / 60) + cruisePowerW * (enduranceMin / 60)) * reserveFactor;
    hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, idealRotorDiameterM, powerPerMotorW: hoverPowerTotalW / motorCount, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
    batteryMassKg = batteryEnergyWh / batteryEnergyDensityWhKg;
    motorMassKg = hardware.motor.massKg * motorCount;
    rotorMassKg = hardware.rotorMassPerAssemblyKg * motorCount;
    structureMassKg = Math.max(0.7, (payloadKg + batteryMassKg + motorMassKg + rotorMassKg + electronicsMassKg) * structureFraction);
    const nextMassKg = payloadKg + batteryMassKg + motorMassKg + rotorMassKg + electronicsMassKg + structureMassKg;
    massKg = massKg * 0.45 + nextMassKg * 0.55;
  }
  const totalThrustN = massKg * 9.80665 * takeoffThrustToWeight;
  const thrustPerMotorN = totalThrustN / motorCount;
  idealRotorDiameterM = 2 * Math.sqrt(thrustPerMotorN / idealDiskLoadingNpm2 / Math.PI);
  hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, idealRotorDiameterM, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
  rotorDiameterM = hardware.rotor.diameterIn * 0.0254;
  const rotorDiskAreaPerMotorM2 = Math.PI * Math.pow(rotorDiameterM / 2, 2);
  actualDiskLoadingNpm2 = thrustPerMotorN / Math.max(rotorDiskAreaPerMotorM2, 0.001);
  const finalWeightN = massKg * 9.80665;
  const finalTotalRotorDiskAreaM2 = motorCount * rotorDiskAreaPerMotorM2;
  hoverPowerTotalW = Math.pow(finalWeightN, 1.5) / Math.sqrt(2 * rhoKgM3 * finalTotalRotorDiskAreaM2) / hoverFigureOfMerit;
  takeoffPowerTotalW = hoverPowerTotalW * Math.pow(takeoffThrustToWeight, 1.5);
  cruisePowerW = (finalWeightN / cruiseLiftToDrag) * cruiseSpeedMS / cruisePropulsiveEfficiency;
  batteryEnergyWh = (takeoffPowerTotalW * (hoverTimeMin / 60) + cruisePowerW * (enduranceMin / 60)) * reserveFactor;
  hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, idealRotorDiameterM, powerPerMotorW: hoverPowerTotalW / motorCount, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
  const batteryMassRequiredKg = batteryEnergyWh / batteryEnergyDensityWhKg;
  batteryMassKg = batteryMassRequiredKg;
  motorMassKg = hardware.motor.massKg * motorCount;
  rotorMassKg = hardware.rotorMassPerAssemblyKg * motorCount;
  const batteryEnvelope = scaledBatteryEnvelope(hardware.battery, batteryMassKg);
  const finalLiftSizedWingAreaM2 = finalWeightN / Math.max(0.5 * rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS * cruiseLiftCoefficient, 1);
  wingAreaM2 = Math.max(finalLiftSizedWingAreaM2, massKg / maximumWingLoadingKgM2);
  actualCruiseLiftCoefficient = finalWeightN / Math.max(0.5 * rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS * wingAreaM2, 1);
  const rotorInsideWingMarginM = 0.08;
  const rotorContainmentSpanM = rotorDiameterM * 2 + Math.max(batteryEnvelope.widthM, 0.06) + rotorInsideWingMarginM * 2;
  wingSpanM = Math.max(Math.sqrt(wingAreaM2 * targetAspectRatio), rotorContainmentSpanM);
  meanChordM = wingAreaM2 / Math.max(wingSpanM, 0.01);
  const finalWingAirfoil = suggestWingAirfoil({ cruiseLiftCoefficient: actualCruiseLiftCoefficient, cruiseSpeedMS });
  const tailAirfoil = suggestTailAirfoil();
  const finAirfoil = suggestFinAirfoil();
  const powerPerMotorW = hoverPowerTotalW / motorCount;
  fuselageLengthM = Math.max(batteryEnvelope.lengthM + 0.08, 0.24);
  fuselageWidthM = Math.max(batteryEnvelope.widthM + 0.06, 0.12);
  const totalWidthM = wingSpanM;
  const targetTotalLengthM = Math.max(totalWidthM * lengthRatio, Math.max(fuselageLengthM, meanChordM));
  const wingRootDepthM = Math.max(fuselageLengthM, meanChordM) / 2;
  const minTailArmM = Math.max(meanChordM * 1.35, rotorDiameterM * 0.46);
  const tailSizing = solveTailForLengthRatio({
    maxTailSpanM: rotorDiameterM,
    meanChordM,
    minTailArmM,
    noseContributionM: wingRootDepthM,
    tailVolumeRatio,
    targetTotalLengthM,
    wingAreaM2,
  });
  const tailArmM = tailSizing.tailArmM;
  const tailAreaM2 = tailSizing.tailAreaM2;
  const tailAreaPerEmpennageM2 = tailAreaM2 / fixedAircraftTailplaneCount;
  const tailChordM = tailSizing.tailChordM;
  const motorX = wingSpanM / 2 - rotorDiameterM / 2 - rotorInsideWingMarginM;
  const totalLengthM = wingRootDepthM + tailArmM + tailChordM;
  fuselageLengthM = Math.max(fuselageLengthM, totalLengthM * 0.7);
  const finVolumeRatio = bestGuessFinVolumeTarget();
  const finAreaTotalM2 = (finVolumeRatio * wingAreaM2 * wingSpanM) / Math.max(tailArmM, 0.1);
  const finAreaPerFinM2 = finAreaTotalM2 / fixedAircraftFinCount;
  const finHeightM = Math.sqrt(finAreaPerFinM2 * 1.35);
  const finChordM = finAreaPerFinM2 / Math.max(finHeightM, 0.01);
  const wingLoadingKgM2 = massKg / Math.max(wingAreaM2, 0.01);
  const actualAspectRatio = Math.pow(wingSpanM, 2) / Math.max(wingAreaM2, 0.01);
  const stallSpeedMS = Math.sqrt((2 * massKg * 9.80665) / (rhoKgM3 * Math.max(wingAreaM2, 0.01) * finiteWingMaxLiftCoefficient(finalWingAirfoil)));
  const takeoffTargetKg = thrustPerMotorN / 9.80665;
  const thrustMarginPct = ((hardware.motor.maxThrustKg / Math.max(takeoffTargetKg, 0.1)) - 1) * 100;
  const propulsionMtowKg = (hardware.motor.maxThrustKg * motorCount) / Math.max(takeoffThrustToWeight, 0.1);
  const batteryEnergyAvailableWh = batteryMassKg * batteryEnergyDensityWhKg;
  const hardwareWithLoads = {
    ...hardware,
    hoverLoadKg: massKg / motorCount,
    takeoffTargetKg,
  };
  return {
    actualDiskLoadingNpm2,
    aspectRatio: actualAspectRatio,
    batteryEnvelope,
    batteryEnergyWh,
    batteryEnergyAvailableWh,
    batteryMassKg,
    batteryMassRequiredKg,
    cruiseLiftCoefficient: actualCruiseLiftCoefficient,
    cruiseLiftToDrag,
    cruisePowerW,
    diskLoadingNpm2: idealDiskLoadingNpm2,
    electronicsMassKg,
    finAreaPerFinM2,
    finChordM,
    finHeightM,
    finVolumeRatio,
    fuselageLengthM,
    fuselageWidthM,
    hardware: hardwareWithLoads,
    hoverPowerTotalW,
    takeoffPowerTotalW,
    hoverFigureOfMerit,
    idealRotorDiameterM,
    massKg,
    meanChordM,
    motorMassKg,
    powerPerMotorW,
    propulsionMtowKg,
    payloadKg,
    rotorBladeCount,
    rotorDiameterM,
    rotorMassKg,
    stallSpeedMS,
    structureMassKg,
    structureFraction,
    finAirfoil,
    tailAreaPerEmpennageM2,
    tailAirfoil,
    tailAreaM2,
    tailArmM,
    tailVolumeRatio,
    thrustPerMotorN,
    thrustMarginPct,
    totalLengthM,
    totalThrustN,
    totalWidthM,
    wingAirfoil: finalWingAirfoil,
    wingAreaM2,
    wingRootDepthM,
    wingLoadingKgM2,
    wingSpanM,
    shapes: sizingDraftReferenceShapes({
      fuselageLengthM,
      fuselageWidthM,
      meanChordM,
      motorDiameterM: hardware.motor.diameterM,
      motorLengthM: hardware.motor.lengthM,
      finChordM,
      finHeightM,
      rotorBladeCount,
      rotorDiameterM,
      finAirfoil,
      tailAreaM2,
      tailAirfoil,
      tailArmM,
      wingAirfoil: finalWingAirfoil,
      wingAreaM2,
      wingSpanM,
    }),
  };
}

export function sizingDraftReferenceShapes({
  fuselageLengthM,
  fuselageWidthM,
  finAirfoil,
  finChordM,
  finHeightM,
  meanChordM,
  motorDiameterM,
  motorLengthM,
  rotorDiameterM,
  rotorBladeCount,
  tailAirfoil,
  tailAreaM2,
  tailArmM,
  wingAirfoil,
  wingAreaM2,
  wingSpanM,
}: {
  fuselageLengthM: number;
  fuselageWidthM: number;
  finAirfoil: string;
  finChordM: number;
  finHeightM: number;
  meanChordM: number;
  motorDiameterM?: number;
  motorLengthM?: number;
  rotorDiameterM: number;
  rotorBladeCount: number;
  tailAirfoil: string;
  tailAreaM2: number;
  tailArmM: number;
  wingAirfoil: string;
  wingAreaM2: number;
  wingSpanM: number;
}): SizingProject["shapes"] {
  const halfSpan = wingSpanM / 2;
  const tailAreaPerEmpennageM2 = tailAreaM2 / fixedAircraftTailplaneCount;
  const tailGeometry = tailGeometryForArea(tailAreaPerEmpennageM2, rotorDiameterM);
  const tailSpan = tailGeometry.spanM;
  const tailChord = tailGeometry.chordM;
  const tailY = -tailArmM;
  const motorY = meanChordM * 0.05;
  const motorX = Math.max(fuselageWidthM / 2 + rotorDiameterM / 2 + 0.04, halfSpan - rotorDiameterM / 2 - 0.08);
  const motorDiameter = Math.max(motorDiameterM ?? rotorDiameterM * 0.18, 0.01);
  const motorLength = Math.max(motorLengthM ?? rotorDiameterM * 0.12, 0.02);
  const boomWidthM = Math.max(meanChordM * 0.08, 0.035);
  return [
    {
      id: "sizing-ref-fuselage",
      role: "body",
      label: "Sizing fuselage",
      drawMode: "line",
      points: [
        { xM: 0, yM: fuselageLengthM / 2, curveMode: "corner" },
        { xM: fuselageWidthM / 2, yM: fuselageLengthM / 2, curveMode: "corner" },
        { xM: fuselageWidthM / 2, yM: -fuselageLengthM / 2, curveMode: "corner" },
        { xM: 0, yM: -fuselageLengthM / 2, curveMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-wing",
      role: "liftingSurface",
      liftingSurfaceKind: "wing",
      label: "Sizing wing",
      drawMode: "line",
      points: [
        { xM: 0, yM: meanChordM * 0.5, curveMode: "corner" },
        { xM: halfSpan, yM: meanChordM * 0.42, curveMode: "corner" },
        { xM: halfSpan, yM: -meanChordM * 0.48, curveMode: "corner" },
        { xM: 0, yM: -meanChordM * 0.5, curveMode: "corner" },
      ],
      airfoil: wingAirfoil,
      airfoilStations: { root: wingAirfoil, tip: wingAirfoil },
    },
    {
      id: "sizing-ref-tail-boom",
      role: "body",
      label: "Sizing tail boom",
      drawMode: "line",
      points: [
        { xM: motorX - boomWidthM / 2, yM: motorY, curveMode: "corner" },
        { xM: motorX + boomWidthM / 2, yM: motorY, curveMode: "corner" },
        { xM: motorX + boomWidthM / 2, yM: tailY - tailChord * 0.75, curveMode: "corner" },
        { xM: motorX - boomWidthM / 2, yM: tailY - tailChord * 0.75, curveMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-tail",
      role: "liftingSurface",
      liftingSurfaceKind: "tailplane",
      label: "Sizing dual empennage",
      drawMode: "line",
      points: [
        { xM: motorX - tailSpan / 2, yM: tailY + tailChord * 0.5, curveMode: "corner" },
        { xM: motorX + tailSpan / 2, yM: tailY + tailChord * 0.45, curveMode: "corner" },
        { xM: motorX + tailSpan / 2, yM: tailY - tailChord * 0.45, curveMode: "corner" },
        { xM: motorX - tailSpan / 2, yM: tailY - tailChord * 0.5, curveMode: "corner" },
      ],
      airfoil: tailAirfoil,
      airfoilStations: { root: tailAirfoil, tip: tailAirfoil },
    },
    {
      id: "sizing-ref-fin",
      role: "liftingSurface",
      liftingSurfaceKind: "fin",
      label: "Sizing fin",
      drawMode: "line",
      sketchViewMode: "side",
      sideViewStationId: "implicit-x-axis-mirror",
      points: [
        { xM: 0, yM: tailY + finChordM * 0.55, curveMode: "corner" },
        { xM: finHeightM, yM: tailY + finChordM * 0.4, curveMode: "corner" },
        { xM: finHeightM, yM: tailY - finChordM * 0.5, curveMode: "corner" },
        { xM: 0, yM: tailY - finChordM * 0.55, curveMode: "corner" },
      ],
      airfoil: finAirfoil,
      airfoilStations: { root: finAirfoil, tip: finAirfoil },
      incidenceDeg: 0,
      incidenceStationsDeg: { root: 0, tip: 0 },
      bodyMaterial: "carbonFibre",
      bodyThicknessMm: 1.2,
      massKg: 0.15,
    },
    {
      id: "sizing-ref-fin-mirror",
      role: "mirrorPlane",
      label: "Fin mirror plane",
      drawMode: "line",
      sketchViewMode: "side",
      sideViewStationId: "implicit-x-axis-mirror",
      points: [
        { xM: 0, yM: tailY + finChordM * 0.75, curveMode: "corner" },
        { xM: 0, yM: tailY - finChordM * 0.75, curveMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-motor",
      role: "part" as const,
      partType: "motor" as const,
      label: "Sizing motor",
      drawMode: "line" as const,
      points: [
        { xM: motorX - motorDiameter / 2, yM: motorY - motorLength / 2, curveMode: "corner" as const },
        { xM: motorX + motorDiameter / 2, yM: motorY - motorLength / 2, curveMode: "corner" as const },
        { xM: motorX + motorDiameter / 2, yM: motorY + motorLength / 2, curveMode: "corner" as const },
        { xM: motorX - motorDiameter / 2, yM: motorY + motorLength / 2, curveMode: "corner" as const },
      ],
    },
    {
      id: "sizing-ref-rotor",
      role: "part" as const,
      partType: "rotor" as const,
      rotorBladeCount,
      label: "Sizing rotor",
      drawMode: "line" as const,
      points: [
        { xM: motorX, yM: motorY, curveMode: "corner" as const },
        { xM: motorX + rotorDiameterM / 2, yM: motorY, curveMode: "corner" as const },
      ],
    },
  ];
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeSizingRotorBladeCount(value: number) {
  const bladeCount = Math.round(value);
  return bladeCount === 3 || bladeCount === 4 ? bladeCount : 2;
}

export function hoverFigureOfMeritForBladeCount(bladeCount: number) {
  if (bladeCount === 3) return 0.6;
  if (bladeCount === 4) return 0.56;
  return 0.62;
}

function solveTailForLengthRatio({
  maxTailSpanM,
  meanChordM,
  minTailArmM,
  noseContributionM,
  tailVolumeRatio,
  targetTotalLengthM,
  wingAreaM2,
}: {
  maxTailSpanM: number;
  meanChordM: number;
  minTailArmM: number;
  noseContributionM: number;
  tailVolumeRatio: number;
  targetTotalLengthM: number;
  wingAreaM2: number;
}) {
  let tailArmM = Math.max(minTailArmM, targetTotalLengthM - noseContributionM - meanChordM * 0.18);
  let tailAreaM2 = 0;
  let tailChordM = meanChordM * 0.18;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    tailAreaM2 = (tailVolumeRatio * wingAreaM2 * meanChordM) / Math.max(tailArmM, 0.1);
    const tailAreaPerEmpennageM2 = tailAreaM2 / fixedAircraftTailplaneCount;
    tailChordM = tailGeometryForArea(tailAreaPerEmpennageM2, maxTailSpanM).chordM;
    tailArmM = Math.max(minTailArmM, targetTotalLengthM - noseContributionM - tailChordM);
  }
  tailAreaM2 = (tailVolumeRatio * wingAreaM2 * meanChordM) / Math.max(tailArmM, 0.1);
  const tailAreaPerEmpennageM2 = tailAreaM2 / fixedAircraftTailplaneCount;
  tailChordM = tailGeometryForArea(tailAreaPerEmpennageM2, maxTailSpanM).chordM;
  return { tailAreaM2, tailArmM, tailChordM };
}

function tailGeometryForArea(areaPerEmpennageM2: number, maxSpanM: number) {
  const idealSpanM = Math.sqrt(areaPerEmpennageM2 * 3.2);
  const spanM = Math.min(idealSpanM, Math.max(maxSpanM, 0.05));
  return {
    chordM: areaPerEmpennageM2 / Math.max(spanM, 0.01),
    spanM,
  };
}

export function bestGuessDiskLoadingNpm2({
  cruiseSpeedMS,
  enduranceMin,
  hoverTimeMin,
}: {
  cruiseSpeedMS: number;
  enduranceMin: number;
  hoverTimeMin: number;
}) {
  const enduranceBias = enduranceMin >= 40 ? -40 : enduranceMin >= 20 ? -20 : enduranceMin <= 10 ? 40 : 0;
  const hoverBias = hoverTimeMin >= 3 ? -30 : hoverTimeMin <= 1 ? 30 : 0;
  const speedBias = cruiseSpeedMS > 24 ? 70 : cruiseSpeedMS < 14 ? -30 : 0;
  return clampNumber(430 + enduranceBias + hoverBias + speedBias, 260, 650);
}

export function bestGuessCruiseLiftCoefficient({ cruiseSpeedMS }: { cruiseSpeedMS: number }) {
  const speedBias = cruiseSpeedMS > 24 ? -0.08 : cruiseSpeedMS < 14 ? 0.05 : 0;
  return clampNumber(1.3 + speedBias, 1.05, 1.45);
}

export function suggestWingAirfoil({
  cruiseLiftCoefficient,
  cruiseSpeedMS,
}: {
  cruiseLiftCoefficient: number;
  cruiseSpeedMS: number;
}) {
  if (cruiseLiftCoefficient >= 0.66 || cruiseSpeedMS < 14) return "Selig S1223";
  if (cruiseLiftCoefficient >= 0.58) return "Clark Y";
  if (cruiseSpeedMS > 24) return "MH 32";
  return "NACA 2412";
}

export function suggestTailAirfoil() {
  return "NACA 0012";
}

export function suggestFinAirfoil() {
  return "NACA 0010";
}

function finiteWingMaxLiftCoefficient(airfoil: string) {
  if (airfoil === "Selig S1223") return 1.8;
  if (airfoil === "Clark Y") return 1.45;
  if (airfoil === "NACA 2412") return 1.5;
  return 1.25;
}

export function bestGuessTailVolumeTarget({ hoverTimeMin }: { hoverTimeMin: number }) {
  return hoverTimeMin >= 3 ? 1.05 : 0.95;
}

export function bestGuessFinVolumeTarget() {
  return 0.04;
}

export function knotsToMS(valueKt: number) {
  return valueKt * metersPerSecondPerKnot;
}

export function msToKnots(valueMS: number) {
  return valueMS / metersPerSecondPerKnot;
}

function roundInputValue(value: number) {
  return Math.round(value * 10) / 10;
}

function formatPower(valueW: number) {
  if (Math.abs(valueW) >= 1000) return `${(valueW / 1000).toFixed(1)} kW`;
  return `${valueW.toFixed(0)} W`;
}
