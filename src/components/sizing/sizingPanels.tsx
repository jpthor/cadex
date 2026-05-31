import { Battery, Plane, Ruler, Scale, Settings2, Wind, Zap } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { auditedSizingAssumptions, computeSizingAnalysis, tailplaneAuthorityFactor } from "../../sizing/auditedSizingEngine";
import { fixedAircraftFinCount, fixedAircraftMotorCount, fixedAircraftTailplaneCount, metersPerSecondPerKnot } from "../../app/constants";
import type { SizingProject } from "../../sizing";
import { installedEnergyForMissionWh, reserveEnergyForMissionWh } from "../../sizing/energy";
import { Metric } from "../ui/Metric";
import { PropulsionNumberField } from "../propulsion/fields";
import { sizingInputInfo } from "./sizingInputInfo";
import { sizingMetricInfo } from "./sizingMetricInfo";


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
  const targetLengthM = computedDraft.requestedTotalLengthM;
  const actualLengthRatio = computedDraft.totalLengthM / Math.max(computedDraft.totalWidthM, 0.01);
  const lengthConstraint = planformLengthDriver(computedDraft);
  const widthDriver = computedDraft.wingSpanM > computedDraft.aspectRatioSpanM + 0.01 ? "Rotor clearance" : "Aspect ratio";
  function updateMission(patch: Partial<SizingProject["mission"]>) {
    const nextProject = { ...project, mission: { ...project.mission, ...patch } };
    onProjectChange(nextProject);
  }
  return (
    <main className="sizing-dashboard">
      <section className="sizing-dashboard-panel sizing-dashboard-intro">
        <PanelTitle icon={<Plane size={16} />} title="Why Sizing First" />
        <p className="dashboard-muted">
          Start here to turn the mission into rough aircraft proportions: mass, wing, battery, rotor, and tail scale.
          These numbers become the target for Sketch, where you draw the actual aircraft and replace guesses with geometry.
        </p>
      </section>
      <section className="sizing-dashboard-panel sizing-dashboard-requirements">
        <PanelTitle icon={<Settings2 size={16} />} title="Mission Inputs" />
        <p className="dashboard-muted">Electric VTOL, 2 rotors, 2 motors, dual empennage surfaces in rotor wake.</p>
        <div className="sizing-input-grid">
          <PropulsionNumberField
            info={sizingInputInfo.Payload}
            label="Payload"
            suffix="kg"
            step={0.1}
            value={project.mission.payloadKg}
            onChange={(payloadKg) => updateMission({ payloadKg: Math.max(0, payloadKg) })}
          />
          <PropulsionNumberField
            info={sizingInputInfo["Takeoff T/W"]}
            label="Takeoff T/W"
            step={0.1}
            value={project.mission.takeoffThrustToWeight}
            onChange={(takeoffThrustToWeight) => updateMission({ takeoffThrustToWeight: Math.max(0.1, takeoffThrustToWeight) })}
          />
          <label className="propulsion-field">
            <SizingInputLabel label="G-rating" />
            <div>
              <select
                value={normalizeSizingGRating(project.mission.gRating)}
                onChange={(event) => updateMission({ gRating: normalizeSizingGRating(Number(event.target.value)) })}
              >
                <option value={2}>2G - 60deg bank turn</option>
                <option value={3}>3G - strong manoeuvre</option>
                <option value={4}>4G - aerobatic</option>
                <option value={5}>5G - high load</option>
                <option value={6}>6G - extreme</option>
              </select>
            </div>
          </label>
          <PropulsionNumberField
            info={sizingInputInfo["Cruise speed"]}
            label="Cruise speed"
            suffix="kt"
            step={1}
            value={roundInputValue(msToKnots(project.mission.cruiseSpeedMS))}
            onChange={(cruiseSpeedKt) => updateMission({ cruiseSpeedMS: Math.max(1, knotsToMS(cruiseSpeedKt)) })}
          />
          <PropulsionNumberField
            info={sizingInputInfo["Target cruise CL"]}
            label="Target cruise CL"
            step={0.05}
            value={project.mission.cruiseLiftCoefficient}
            onChange={(cruiseLiftCoefficient) => updateMission({ cruiseLiftCoefficient: clampNumber(cruiseLiftCoefficient, 0.25, 1.4) })}
          />
          <PropulsionNumberField
            info={sizingInputInfo["Aspect ratio"]}
            label="Aspect ratio"
            step={0.1}
            value={project.mission.aspectRatio}
            onChange={(aspectRatio) => updateMission({ aspectRatio: Math.min(12, Math.max(2.2, aspectRatio)) })}
          />
          <PropulsionNumberField
            info={sizingInputInfo["Length ratio"]}
            label="Length ratio"
            step={0.05}
            value={project.mission.lengthRatio}
            onChange={(lengthRatio) => updateMission({ lengthRatio: Math.min(2, Math.max(0.45, lengthRatio)) })}
          />
          <PropulsionNumberField
            info={sizingInputInfo.Endurance}
            label="Endurance"
            suffix="min"
            step={1}
            value={project.mission.enduranceMin}
            onChange={(enduranceMin) => updateMission({ enduranceMin: Math.max(1, enduranceMin) })}
          />
          <PropulsionNumberField
            info={sizingInputInfo["Hover allowance"]}
            label="Hover allowance"
            suffix="min"
            step={0.5}
            value={project.mission.hoverTimeMin}
            onChange={(hoverTimeMin) => updateMission({ hoverTimeMin: Math.max(0, hoverTimeMin) })}
          />
          <PropulsionNumberField
            info={sizingInputInfo.Reserve}
            label="Reserve"
            suffix="%"
            step={5}
            value={project.mission.reservePct}
            onChange={(reservePct) => updateMission({ reservePct: Math.min(90, Math.max(0, reservePct)) })}
          />
          <label className="propulsion-field">
            <SizingInputLabel label="Rotor blades" />
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
          <SizingMetric label="Estimated mass" value={`${computedDraft.massKg.toFixed(2)} kg`} />
          <SizingMetric label="Wingspan" value={`${computedDraft.wingSpanM.toFixed(2)} m`} />
          <SizingMetric label="Wing area" value={`${computedDraft.wingAreaM2.toFixed(3)} m2`} />
          <SizingMetric label="Battery mass" value={`${computedDraft.batteryMassKg.toFixed(2)} kg`} />
          <SizingMetric label="Rotor diameter" value={`${(computedDraft.rotorDiameterM * 1000).toFixed(0)} mm`} />
        </div>
      </section>
      <section className="sizing-dashboard-panel sizing-dashboard-data">
            <SizingDataGroup icon={<Scale size={15} />} title="Mass Build-Up">
              <SizingMetric label="Payload" value={`${computedDraft.payloadKg.toFixed(2)} kg`} />
              <SizingMetric label="Structure" value={`${computedDraft.structureMassKg.toFixed(2)} kg`} />
              <SizingMetric label="Total motor mass" value={`${computedDraft.motorMassKg.toFixed(2)} kg`} />
              <SizingMetric label="Rotor mass" value={`${computedDraft.rotorMassKg.toFixed(2)} kg`} />
              <SizingMetric label="Battery mass" value={`${computedDraft.batteryMassKg.toFixed(2)} kg`} />
              <SizingMetric label="Electronics" value={`${computedDraft.electronicsMassKg.toFixed(2)} kg`} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Battery size={15} />} title="Battery & Energy">
              <SizingMetric label="Cruise energy" value={`${computedDraft.cruiseEnergyWh.toFixed(0)} Wh`} />
              <SizingMetric label="Hover energy" value={`${computedDraft.hoverEnergyWh.toFixed(0)} Wh`} />
              <SizingMetric label="Mission energy" value={`${computedDraft.missionEnergyWh.toFixed(0)} Wh`} />
              <SizingMetric label="Installed pack energy" value={`${computedDraft.installedBatteryEnergyWh.toFixed(0)} Wh`} />
              <SizingMetric label="Reserve energy" value={`${computedDraft.reserveEnergyWh.toFixed(0)} Wh`} />
              <SizingMetric label="Battery mass" value={`${computedDraft.batteryMassKg.toFixed(2)} kg`} />
              <SizingMetric label="Energy density" value={`${computedDraft.batteryEnergyDensityWhKg.toFixed(0)} Wh/kg`} />
              <SizingMetric label="Flight target" value={`${project.mission.enduranceMin.toFixed(0)} min cruise + ${project.mission.hoverTimeMin.toFixed(0)} min hover`} />
              <SizingMetric label="Reserve" value={`${project.mission.reservePct.toFixed(0)}% landing reserve`} />
              <SizingMetric label="Battery L x W x H" value={`${(computedDraft.batteryEnvelope.lengthM * 1000).toFixed(0)} x ${(computedDraft.batteryEnvelope.widthM * 1000).toFixed(0)} x ${(computedDraft.batteryEnvelope.heightM * 1000).toFixed(0)} mm`} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Ruler size={15} />} title="Planform Geometry">
              <SizingMetric label="Total length" value={`${computedDraft.totalLengthM.toFixed(2)} m`} />
              <SizingMetric label="Total width" value={`${computedDraft.totalWidthM.toFixed(2)} m`} />
              <SizingMetric label="Target length" value={`${targetLengthM.toFixed(2)} m`} />
              <SizingMetric label="Actual L/W" value={`${actualLengthRatio.toFixed(2)}`} />
              <SizingMetric label="Length driver" value={lengthConstraint} />
              <SizingMetric label="Width driver" value={widthDriver} />
              <SizingMetric label="Wing root depth" value={`${computedDraft.wingRootDepthM.toFixed(2)} m from nose`} />
              <SizingMetric label="Fuselage pod L x W" value={`${(computedDraft.fuselageLengthM * 1000).toFixed(0)} x ${(computedDraft.fuselageWidthM * 1000).toFixed(0)} mm`} />
              <SizingMetric label="Payload bay length" value={`${(computedDraft.payloadBayLengthM * 1000).toFixed(0)} mm`} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Wind size={15} />} title="Wing & Aero">
              <SizingMetric label="Wing area" value={`${computedDraft.wingAreaM2.toFixed(3)} m2`} />
              <SizingMetric label="Area driver" value={computedDraft.wingAreaDriver} />
              <SizingMetric label="Wing chord" value={`${computedDraft.meanChordM.toFixed(3)} m`} />
              <SizingMetric label="Actual aspect ratio" value={`${computedDraft.aspectRatio.toFixed(2)}`} />
              <SizingMetric label="Actual cruise CL" value={`${computedDraft.cruiseLiftCoefficient.toFixed(2)}`} />
              <SizingMetric label="Suggested aerofoil" value={computedDraft.wingAirfoil} />
              <SizingMetric label="Stall CLmax" value={`${computedDraft.maxLiftCoefficient.toFixed(2)}`} />
              <SizingMetric label="Wing loading" value={`${computedDraft.wingLoadingKgM2.toFixed(1)} kg/m2`} />
              <SizingMetric label="Cruise / stall" value={`${computedDraft.cruiseToStallRatio.toFixed(1)}x`} />
              <SizingMetric label="Stall speed" value={`${msToKnots(computedDraft.stallSpeedMS).toFixed(0)} kt`} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Ruler size={15} />} title="Tail Surfaces">
              <SizingMetric label="Tail volume ratio" value={`${computedDraft.tailVolumeRatio.toFixed(2)} raw / ${computedDraft.tailVolumeEffectiveRatio.toFixed(2)} effective`} />
              <SizingMetric label="Tail authority factor" value={`${computedDraft.tailAuthorityFactor.toFixed(2)}x`} />
              <SizingMetric label="Tail area total" value={`${computedDraft.tailAreaM2.toFixed(3)} m2`} />
              <SizingMetric label="Tail area / tailplane" value={`${computedDraft.tailAreaPerEmpennageM2.toFixed(3)} m2`} />
              <SizingMetric label="Tailplane span x chord" value={`${computedDraft.tailSpanM.toFixed(2)} m x ${computedDraft.tailChordM.toFixed(2)} m`} />
              <SizingMetric label="Tailplane AR" value={`${computedDraft.tailAspectRatio.toFixed(2)}`} />
              <SizingMetric label="Tail arm" value={`${computedDraft.tailArmM.toFixed(2)} m`} />
              <SizingMetric label="Tail arm driver" value={computedDraft.tailArmDriver} />
              <SizingMetric label="Tail aerofoil" value={computedDraft.tailAirfoil} />
              <SizingMetric label="Fin volume ratio" value={`${computedDraft.finVolumeRatio.toFixed(3)}`} />
              <SizingMetric label="Fin area total" value={`${(computedDraft.finAreaPerFinM2 * fixedAircraftFinCount).toFixed(3)} m2`} />
              <SizingMetric label="Vertical fins" value={`${fixedAircraftFinCount}`} />
              <SizingMetric label="Fin area / fin" value={`${computedDraft.finAreaPerFinM2.toFixed(3)} m2`} />
              <SizingMetric label="Fin height x chord" value={`${computedDraft.finHeightM.toFixed(2)} m x ${computedDraft.finChordM.toFixed(2)} m`} />
              <SizingMetric label="Fin aerofoil" value={computedDraft.finAirfoil} />
            </SizingDataGroup>
            <SizingDataGroup icon={<Zap size={15} />} title="Power & Propulsion">
              <SizingMetric label="Target T/W" value={`${computedDraft.takeoffThrustToWeight.toFixed(2)}`} />
              <SizingMetric label="Total takeoff thrust" value={`${computedDraft.totalThrustN.toFixed(0)} N`} />
              <SizingMetric label="Takeoff thrust / motor" value={`${computedDraft.thrustPerMotorN.toFixed(0)} N`} />
              <SizingMetric label="Hover power" value={`${formatPower(computedDraft.hoverPowerTotalW)} total`} />
              <SizingMetric label="Takeoff power" value={`${formatPower(computedDraft.takeoffPowerTotalW)} total`} />
              <SizingMetric label="Cruise power" value={formatPower(computedDraft.cruisePowerW)} />
              <SizingMetric label="Cruise L/D" value={`${computedDraft.cruiseLiftToDrag.toFixed(1)}`} />
              <SizingMetric label="Cruise propulsive efficiency" value={`${(computedDraft.cruisePropulsiveEfficiency * 100).toFixed(0)}%`} />
              <SizingMetric label="Hover power / motor" value={`${formatPower(computedDraft.hoverPowerPerMotorW)} each`} />
              <SizingMetric label="Takeoff power / motor" value={`${formatPower(computedDraft.takeoffPowerPerMotorW)} each`} />
              <SizingMetric label="Hover figure of merit" value={`${computedDraft.hoverFigureOfMerit.toFixed(2)}`} />
              <SizingMetric label="Target disk loading" value={`${computedDraft.diskLoadingNpm2.toFixed(0)} N/m2`} />
              <SizingMetric label="Resulting disk loading" value={`${computedDraft.actualDiskLoadingNpm2.toFixed(0)} N/m2`} />
              <SizingMetric label="Ideal rotor diameter" value={`${(computedDraft.idealRotorDiameterM * 1000).toFixed(0)} mm`} />
              <SizingMetric label="Suggested rotor diameter" value={`${(computedDraft.rotorDiameterM * 1000).toFixed(0)} mm`} />
              {hardwarePick ? (
                <>
                  <SizingMetric label="Motor basis" value={hardwarePick.motor.name} />
                  <SizingMetric label="Motor mass driver" value={hardwarePick.motor.massDriver} />
                  <SizingMetric label="Motor diameter" value={`${(hardwarePick.motor.diameterM * 1000).toFixed(0)} mm`} />
                  <SizingMetric label="Motor length" value={`${(hardwarePick.motor.lengthM * 1000).toFixed(0)} mm`} />
                  <SizingMetric label="Mass / motor" value={`${hardwarePick.motor.massKg.toFixed(2)} kg each`} />
                  <SizingMetric label="Reference thrust / motor" value={`${hardwarePick.motor.baseMaxThrustKg.toFixed(1)} kgf catalogue`} />
                  <SizingMetric label="Sizing thrust / motor" value={`${hardwarePick.motor.sizingThrustTargetKg.toFixed(1)} kgf with margin`} />
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

function SizingInputLabel({ label }: { label: string }) {
  const info = sizingInputInfo[label];
  return (
    <span className={`field-label ${info ? "has-info" : ""}`}>
      {label}
      {info ? <span className="field-tooltip">{info}</span> : null}
    </span>
  );
}

type HardwareMotorReference = {
  diameterM: number;
  dimensionsMm: string;
  lengthM: number;
  massKg: number;
  maxThrustKg: number;
  name: string;
  source: string;
};

type HardwareMotor = HardwareMotorReference & {
  baseMaxThrustKg: number;
  massDriver: string;
  powerSizedMassKg: number;
  sizingPowerW: number;
  sizingThrustTargetKg: number;
  thrustSizedMassKg: number;
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

const actualHardwarePairs: Array<{ motor: HardwareMotorReference; rotor: HardwareRotor }> = [
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
  const sizingPowerW = Math.max(powerPerMotorW ?? 0, 0);
  const powerSizedMassKg = sizingPowerW / catalogueMotorPowerDensityWKg;
  const thrustSizedMassKg = thrustTargetKg * motorMassPerThrustKg;
  const motorMassKg = Math.max(pair.motor.massKg, powerSizedMassKg, thrustSizedMassKg);
  const massDriver =
    motorMassKg === pair.motor.massKg ? "Catalogue minimum" : motorMassKg === powerSizedMassKg ? "Takeoff power" : "Thrust target";
  const motorScale = Math.cbrt(motorMassKg / Math.max(pair.motor.massKg, 0.01));
  const motorDiameterM = pair.motor.diameterM * motorScale;
  const motorLengthM = pair.motor.lengthM * motorScale;
  const motor: HardwareMotor = {
    ...pair.motor,
    baseMaxThrustKg: pair.motor.maxThrustKg,
    diameterM: motorDiameterM,
    dimensionsMm: `${(motorDiameterM * 1000).toFixed(0)} x ${(motorLengthM * 1000).toFixed(0)} mm est.`,
    lengthM: motorLengthM,
    massDriver,
    massKg: motorMassKg,
    maxThrustKg: thrustTargetKg,
    name: pair.motor.name,
    powerSizedMassKg,
    sizingPowerW,
    sizingThrustTargetKg: thrustTargetKg,
    source: `${pair.motor.source}; scaled only if power demand exceeds catalogue envelope`,
    thrustSizedMassKg,
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
const motorMassPerThrustKg = 0.012;
const propMassDiameterExponent = 2.15;
const minimumElectronicsMassKg = 0.9;
const avionicsBaseMassKg = 0.55;
const controllerAllowancePerMotorKg = 0.15;
const highVoltageElectronicsKgPerKw = 0.075;
const payloadBatteryClearanceM = 0.12;
const payloadPackagingDensityKgM3 = 1000;
const payloadPackagingFillFraction = 0.7;

function estimatePayloadBayLengthM(payloadKg: number, fuselageWidthM: number) {
  const internalWidthM = Math.max(fuselageWidthM * 0.85, 0.04);
  const usableCrossSectionM2 = Math.max(internalWidthM * internalWidthM * payloadPackagingFillFraction, 0.002);
  return Math.max(0.08, Math.max(payloadKg, 0) / payloadPackagingDensityKgM3 / usableCrossSectionM2);
}

function scaledBatteryEnvelope(referenceBattery: HardwareBattery, targetMassKg: number) {
  const massKg = Math.max(targetMassKg, 0.01);
  const targetVolumeM3 = massKg / auditedSizingAssumptions.lipoPackDensityKgM3;
  const referenceAspect = Math.max(referenceBattery.lengthM / Math.max(referenceBattery.widthM, 0.001), 1);
  const referenceThicknessM = Math.max(referenceBattery.heightM, auditedSizingAssumptions.batteryThicknessClampM.min);
  const thicknessM = clampNumber(
    referenceThicknessM,
    auditedSizingAssumptions.batteryThicknessClampM.min,
    auditedSizingAssumptions.batteryThicknessClampM.max,
  );
  const footprintAreaM2 = targetVolumeM3 / Math.max(thicknessM, 0.001);
  const widthM = Math.sqrt(footprintAreaM2 / Math.max(referenceAspect, 0.001));
  return {
    heightM: thicknessM,
    lengthM: widthM * referenceAspect,
    massKg,
    widthM,
  };
}

function estimateElectronicsMassKg({
  motorCount,
  takeoffPowerTotalW,
}: {
  motorCount: number;
  takeoffPowerTotalW: number;
}) {
  const takeoffPowerKw = Math.max(takeoffPowerTotalW, 0) / 1000;
  return Math.max(
    minimumElectronicsMassKg,
    avionicsBaseMassKg + motorCount * controllerAllowancePerMotorKg + takeoffPowerKw * highVoltageElectronicsKgPerKw,
  );
}

export function computeSizingDraft(project: SizingProject) {
  const payloadKg = Math.max(project.mission.payloadKg, 0.1);
  const motorCount = fixedAircraftMotorCount;
  const rotorBladeCount = normalizeSizingRotorBladeCount(project.mission.rotorBladeCount);
  const gRating = normalizeSizingGRating(project.mission.gRating);
  const takeoffThrustToWeight = Math.max(project.mission.takeoffThrustToWeight, 0.1);
  const cruiseSpeedMS = Math.max(project.mission.cruiseSpeedMS, 1);
  const enduranceMin = Math.max(project.mission.enduranceMin, 1);
  const hoverTimeMin = Math.max(project.mission.hoverTimeMin, 0);
  const reservePct = Math.min(90, Math.max(project.mission.reservePct, 0));
  const batteryEnergyDensityWhKg = Math.max(project.mission.batteryEnergyDensityWhKg, 1);
  const initialMassGuessKg = Math.max(payloadKg / 0.5, payloadKg + 2.5);
  const targetAspectRatio = clampNumber(numberOr(project.mission.aspectRatio, 2.8), 2.2, 12);
  const lengthRatio = clampNumber(numberOr(project.mission.lengthRatio, 0.8), 0.45, 2);
  const idealDiskLoadingNpm2 = bestGuessDiskLoadingNpm2({ cruiseSpeedMS, enduranceMin, hoverTimeMin });
  const cruiseLiftCoefficient = clampNumber(numberOr(project.mission.cruiseLiftCoefficient, bestGuessCruiseLiftCoefficient({ cruiseSpeedMS })), 0.25, 1.4);
  const wingAirfoil = suggestWingAirfoil({ cruiseLiftCoefficient, cruiseSpeedMS });
  const tailVolumeTarget = Number.isFinite(project.mission.tailVolumeTarget) ? project.mission.tailVolumeTarget : bestGuessTailVolumeTarget();
  const tailAuthorityFactor = tailplaneAuthorityFactor();
  const rawTailVolumeTarget = tailVolumeTarget / Math.max(tailAuthorityFactor, 1);
  const rhoKgM3 = 1.225;
  const hoverFigureOfMerit = hoverFigureOfMeritForBladeCount(rotorBladeCount);
  const cruiseLiftToDrag = 8.2;
  const cruisePropulsiveEfficiency = 0.72;
  const maximumWingLoadingKgM2 = 34;
  const structureFraction = structureFractionForGRating(gRating);
  let electronicsMassKg = estimateElectronicsMassKg({ motorCount, takeoffPowerTotalW: 0 });
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
  let cruiseEnergyWh = 0;
  let hoverEnergyWh = 0;
  let missionEnergyWh = 0;
  let batteryEnergyWh = 0;
  let batteryMassKg = 0;
  let motorMassKg = 0;
  let rotorMassKg = 0;
  let structureMassKg = 0;
  let fuselageLengthM = 0.25;
  let fuselageWidthM = 0.12;
  let payloadBayLengthM = 0.08;
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
    hoverEnergyWh = takeoffPowerTotalW * (hoverTimeMin / 60);
    cruiseEnergyWh = cruisePowerW * (enduranceMin / 60);
    missionEnergyWh = hoverEnergyWh + cruiseEnergyWh;
    batteryEnergyWh = installedEnergyForMissionWh(missionEnergyWh, reservePct);
    hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, idealRotorDiameterM, powerPerMotorW: takeoffPowerTotalW / motorCount, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
    batteryMassKg = batteryEnergyWh / batteryEnergyDensityWhKg;
    motorMassKg = hardware.motor.massKg * motorCount;
    rotorMassKg = hardware.rotorMassPerAssemblyKg * motorCount;
    electronicsMassKg = estimateElectronicsMassKg({ motorCount, takeoffPowerTotalW });
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
  hoverEnergyWh = takeoffPowerTotalW * (hoverTimeMin / 60);
  cruiseEnergyWh = cruisePowerW * (enduranceMin / 60);
  missionEnergyWh = hoverEnergyWh + cruiseEnergyWh;
  batteryEnergyWh = installedEnergyForMissionWh(missionEnergyWh, reservePct);
  hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, idealRotorDiameterM, powerPerMotorW: takeoffPowerTotalW / motorCount, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
  const batteryMassRequiredKg = batteryEnergyWh / batteryEnergyDensityWhKg;
  batteryMassKg = batteryMassRequiredKg;
  motorMassKg = hardware.motor.massKg * motorCount;
  rotorMassKg = hardware.rotorMassPerAssemblyKg * motorCount;
  electronicsMassKg = estimateElectronicsMassKg({ motorCount, takeoffPowerTotalW });
  const batteryEnvelope = scaledBatteryEnvelope(hardware.battery, batteryMassKg);
  const finalLiftSizedWingAreaM2 = finalWeightN / Math.max(0.5 * rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS * cruiseLiftCoefficient, 1);
  const wingLoadingCapAreaM2 = massKg / maximumWingLoadingKgM2;
  wingAreaM2 = Math.max(finalLiftSizedWingAreaM2, wingLoadingCapAreaM2);
  const wingAreaDriver = finalLiftSizedWingAreaM2 >= wingLoadingCapAreaM2 ? "Cruise CL" : "Wing loading cap";
  actualCruiseLiftCoefficient = finalWeightN / Math.max(0.5 * rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS * wingAreaM2, 1);
  const rotorInsideWingMarginM = 0.08;
  const rotorContainmentSpanM = rotorDiameterM * 2 + Math.max(batteryEnvelope.widthM, 0.06) + rotorInsideWingMarginM * 2;
  const aspectRatioSpanM = Math.sqrt(wingAreaM2 * targetAspectRatio);
  wingSpanM = Math.max(aspectRatioSpanM, rotorContainmentSpanM);
  meanChordM = wingAreaM2 / Math.max(wingSpanM, 0.01);
  const finalWingAirfoil = suggestWingAirfoil({ cruiseLiftCoefficient: actualCruiseLiftCoefficient, cruiseSpeedMS });
  const tailAirfoil = suggestTailAirfoil();
  const finAirfoil = suggestFinAirfoil();
  const hoverPowerPerMotorW = hoverPowerTotalW / motorCount;
  const takeoffPowerPerMotorW = takeoffPowerTotalW / motorCount;
  fuselageWidthM = Math.max(batteryEnvelope.widthM + 0.06, 0.12);
  payloadBayLengthM = estimatePayloadBayLengthM(payloadKg, fuselageWidthM);
  fuselageLengthM = Math.max(batteryEnvelope.lengthM + payloadBayLengthM + payloadBatteryClearanceM, 0.24);
  const totalWidthM = wingSpanM;
  const requestedTotalLengthM = totalWidthM * lengthRatio;
  const targetTotalLengthM = Math.max(requestedTotalLengthM, Math.max(fuselageLengthM, meanChordM));
  const wingRootDepthM = Math.max(fuselageLengthM, meanChordM) / 2;
  const minTailArmM = Math.max(meanChordM * 1.35, rotorDiameterM * 0.46);
  const tailSizing = solveTailForLengthRatio({
    maxTailSpanM: rotorDiameterM,
    meanChordM,
    minTailArmM,
    noseContributionM: wingRootDepthM,
    tailVolumeRatio: rawTailVolumeTarget,
    targetTotalLengthM,
    wingAreaM2,
  });
  const tailArmM = tailSizing.tailArmM;
  const tailAreaM2 = tailSizing.tailAreaM2;
  const tailAreaPerEmpennageM2 = tailAreaM2 / fixedAircraftTailplaneCount;
  const tailChordM = tailSizing.tailChordM;
  const tailSpanM = tailSizing.tailSpanM;
  const tailAspectRatio = Math.pow(tailSpanM, 2) / Math.max(tailAreaPerEmpennageM2, 0.001);
  const tailVolumeRatio = (tailAreaM2 * tailArmM) / Math.max(wingAreaM2 * meanChordM, 0.001);
  const tailVolumeEffectiveRatio = tailVolumeRatio * tailAuthorityFactor;
  const tailArmDriver = tailArmM <= minTailArmM + 0.01 ? "Minimum arm" : "Length ratio";
  const motorX = wingSpanM / 2 - rotorDiameterM / 2 - rotorInsideWingMarginM;
  const totalLengthM = wingRootDepthM + tailArmM + tailChordM;
  const finVolumeTarget = bestGuessFinVolumeTarget();
  const finAreaTotalM2 = (finVolumeTarget * wingAreaM2 * wingSpanM) / Math.max(tailArmM, 0.1);
  const finAreaPerFinM2 = finAreaTotalM2 / fixedAircraftFinCount;
  const finHeightM = Math.sqrt(finAreaPerFinM2 * 1.35);
  const finChordM = finAreaPerFinM2 / Math.max(finHeightM, 0.01);
  const finVolumeRatio = (finAreaTotalM2 * tailArmM) / Math.max(wingAreaM2 * wingSpanM, 0.001);
  const wingLoadingKgM2 = massKg / Math.max(wingAreaM2, 0.01);
  const actualAspectRatio = Math.pow(wingSpanM, 2) / Math.max(wingAreaM2, 0.01);
  const maxLiftCoefficient = finiteWingMaxLiftCoefficient(finalWingAirfoil);
  const stallSpeedMS = Math.sqrt((2 * massKg * 9.80665) / (rhoKgM3 * Math.max(wingAreaM2, 0.01) * maxLiftCoefficient));
  const cruiseToStallRatio = cruiseSpeedMS / Math.max(stallSpeedMS, 0.1);
  const takeoffTargetKg = thrustPerMotorN / 9.80665;
  const thrustMarginPct = ((hardware.motor.maxThrustKg / Math.max(takeoffTargetKg, 0.1)) - 1) * 100;
  const propulsionMtowKg = (hardware.motor.maxThrustKg * motorCount) / Math.max(takeoffThrustToWeight, 0.1);
  const installedBatteryEnergyWh = batteryMassKg * batteryEnergyDensityWhKg;
  const reserveEnergyWh = reserveEnergyForMissionWh(missionEnergyWh, reservePct);
  const hardwareWithLoads = {
    ...hardware,
    hoverLoadKg: massKg / motorCount,
    takeoffTargetKg,
  };
  return {
    actualDiskLoadingNpm2,
    aspectRatioSpanM,
    aspectRatio: actualAspectRatio,
    wingAreaDriver,
    liftSizedWingAreaM2: finalLiftSizedWingAreaM2,
    wingLoadingCapAreaM2,
    batteryEnvelope,
    batteryEnergyWh,
    batteryEnergyDensityWhKg,
    batteryEnergyAvailableWh: installedBatteryEnergyWh,
    batteryMassKg,
    batteryMassRequiredKg,
    cruiseEnergyWh,
    cruiseToStallRatio,
    cruiseLiftCoefficient: actualCruiseLiftCoefficient,
    cruiseLiftToDrag,
    cruisePropulsiveEfficiency,
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
    hoverPowerPerMotorW,
    takeoffPowerTotalW,
    takeoffPowerPerMotorW,
    hoverFigureOfMerit,
    idealRotorDiameterM,
    massKg,
    meanChordM,
    missionEnergyWh,
    maxLiftCoefficient,
    hoverEnergyWh,
    installedBatteryEnergyWh,
    motorMassKg,
    powerPerMotorW: hoverPowerPerMotorW,
    propulsionMtowKg,
    payloadKg,
    payloadBayLengthM,
    reserveEnergyWh,
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
    tailArmDriver,
    tailChordM,
    tailSpanM,
    tailAspectRatio,
    tailAuthorityFactor,
    tailVolumeEffectiveRatio,
    tailVolumeRatio,
    thrustPerMotorN,
    thrustMarginPct,
    takeoffThrustToWeight,
    totalLengthM,
    totalThrustN,
    totalWidthM,
    requestedTotalLengthM,
    rotorContainmentSpanM,
    wingAirfoil: finalWingAirfoil,
    wingAreaM2,
    wingRootDepthM,
    wingLoadingKgM2,
    wingSpanM,
    shapes: sizingDraftReferenceShapes({
      batteryEnvelope,
      batteryMassKg,
      fuselageLengthM,
      fuselageWidthM,
      meanChordM,
      motorDiameterM: hardware.motor.diameterM,
      motorLengthM: hardware.motor.lengthM,
      motorMassKg: hardware.motor.massKg,
      payloadKg,
      payloadBayLengthM,
      finChordM,
      finHeightM,
      rotorBladeCount,
      rotorDiameterM,
      rotorMassKg: hardware.rotorMassPerAssemblyKg,
      finAirfoil,
      tailAreaM2,
      tailAirfoil,
      tailArmM,
      totalLengthM,
      wingAirfoil: finalWingAirfoil,
      wingAreaM2,
      wingRootDepthM,
      wingSpanM,
    }),
  };
}

export function sizingDraftReferenceShapes({
  batteryEnvelope,
  batteryMassKg,
  fuselageLengthM,
  fuselageWidthM,
  finAirfoil,
  finChordM,
  finHeightM,
  meanChordM,
  motorDiameterM,
  motorLengthM,
  motorMassKg,
  payloadKg,
  payloadBayLengthM,
  rotorDiameterM,
  rotorBladeCount,
  rotorMassKg,
  tailAirfoil,
  tailAreaM2,
  tailArmM,
  totalLengthM,
  wingAirfoil,
  wingAreaM2,
  wingRootDepthM,
  wingSpanM,
}: {
  batteryEnvelope: { heightM: number; lengthM: number; massKg: number; widthM: number };
  batteryMassKg: number;
  fuselageLengthM: number;
  fuselageWidthM: number;
  finAirfoil: string;
  finChordM: number;
  finHeightM: number;
  meanChordM: number;
  motorDiameterM?: number;
  motorLengthM?: number;
  motorMassKg: number;
  payloadKg: number;
  payloadBayLengthM: number;
  rotorDiameterM: number;
  rotorBladeCount: number;
  rotorMassKg: number;
  tailAirfoil: string;
  tailAreaM2: number;
  tailArmM: number;
  totalLengthM: number;
  wingAirfoil: string;
  wingAreaM2: number;
  wingRootDepthM: number;
  wingSpanM: number;
}): SizingProject["shapes"] {
  const halfSpan = wingSpanM / 2;
  const tailAreaPerEmpennageM2 = tailAreaM2 / fixedAircraftTailplaneCount;
  const tailGeometry = tailGeometryForArea(tailAreaPerEmpennageM2, rotorDiameterM);
  const tailSpan = tailGeometry.spanM;
  const tailChord = tailGeometry.chordM;
  const dartV1 = {
    halfSpanM: 1.158293689273938,
    totalLengthM: 1.73,
  };
  const xScale = halfSpan / dartV1.halfSpanM;
  const yScale = totalLengthM / dartV1.totalLengthM;
  const scaleX = (valueM: number) => valueM * xScale;
  const scaleY = (valueM: number) => valueM * yScale;
  const fuselageScaleY = (valueM: number) => (valueM / 1.4785470499572284) * fuselageLengthM;
  const motorX = scaleX(0.6903118872640711);
  const motorDiameter = Math.max(motorDiameterM ?? rotorDiameterM * 0.18, 0.01);
  const motorLength = Math.max(motorLengthM ?? rotorDiameterM * 0.12, 0.02);
  const fuselageHalfWidthM = fuselageWidthM / 2;
  const batteryHalfWidthM = batteryEnvelope.widthM / 2;
  const batteryLengthM = batteryEnvelope.lengthM;
  const bayClearanceM = Math.max(0.035, Math.min(0.08, payloadBatteryClearanceM / 3));
  const payloadLengthM = Math.max(payloadBayLengthM, 0.08);
  const payloadHalfWidthM = Math.min(fuselageHalfWidthM * 0.72, Math.max(batteryHalfWidthM * 0.75, Math.min(fuselageHalfWidthM, 0.025)));
  const payloadFrontY = -bayClearanceM;
  const payloadRearY = payloadFrontY - payloadLengthM;
  const batteryFrontY = payloadRearY - bayClearanceM;
  const batteryRearY = batteryFrontY - batteryLengthM;
  const wingRootChordM = meanChordM * 1.12;
  const wingTipChordM = Math.max(meanChordM * 0.5, 2 * meanChordM - wingRootChordM);
  const wingRootLeadingY = -wingRootDepthM;
  const wingRootTrailingY = wingRootLeadingY - wingRootChordM;
  const wingTipLeadingY = wingRootLeadingY + meanChordM * 0.14;
  const wingTipTrailingY = wingTipLeadingY - wingTipChordM;
  const wingMidX = motorX;
  const wingMidT = Math.max(0, Math.min(1, wingMidX / Math.max(halfSpan, 0.01)));
  const wingMidLeadingY = wingRootLeadingY + (wingTipLeadingY - wingRootLeadingY) * wingMidT;
  const wingMidTrailingY = wingRootTrailingY + (wingTipTrailingY - wingRootTrailingY) * wingMidT;
  const motorY = (wingMidLeadingY + wingMidTrailingY) / 2;
  const tailMirrorX = motorX;
  const tailOuterX = tailMirrorX + tailSpan / 2;
  const tailTrailingY = -totalLengthM;
  const tailLeadingY = tailTrailingY + tailChord;
  const finHeight = finHeightM;
  const finTrailingY = -totalLengthM;
  const finLeadingY = finTrailingY + finChordM;
  return [
    {
      id: "sizing-ref-fuselage",
      role: "body",
      label: "Suggested fuselage",
      drawMode: "line",
      points: [
        { xM: 0, yM: 0, curveMode: "spline", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: fuselageHalfWidthM, yM: fuselageScaleY(-0.19925435443071243), curveMode: "spline" },
        { xM: fuselageHalfWidthM, yM: fuselageScaleY(-1.040804925708669), curveMode: "spline" },
        { xM: 0, yM: -fuselageLengthM, curveMode: "spline", segmentInMode: "corner", segmentOutMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-wing",
      role: "liftingSurface",
      liftingSurfaceKind: "wing",
      label: "Suggested wing",
      drawMode: "line",
      points: [
        { xM: 0, yM: wingRootLeadingY, curveMode: "spline" },
        { xM: wingMidX, yM: wingMidLeadingY, curveMode: "spline", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: halfSpan, yM: wingTipLeadingY, curveMode: "spline" },
        { xM: halfSpan, yM: wingTipTrailingY, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: wingMidX, yM: wingMidTrailingY, curveMode: "spline", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: 0, yM: wingRootTrailingY, curveMode: "spline" },
      ],
      airfoil: wingAirfoil,
      airfoilStations: { root: wingAirfoil, tip: wingAirfoil },
    },
    {
      id: "sizing-ref-reference-line-1",
      role: "referenceLine",
      label: "Suggested reference line 1",
      drawMode: "line",
      points: [
        { xM: scaleX(0.6903118872640711), yM: 0, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: scaleX(0.6903118872640711), yM: scaleY(-1.73), curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-reference-line-2",
      role: "referenceLine",
      label: "Suggested reference line 2",
      drawMode: "line",
      points: [
        { xM: scaleX(1.158293689273938), yM: 0, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: scaleX(1.158293689273938), yM: scaleY(-1.007279636515194), curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-reference-line-3",
      role: "referenceLine",
      label: "Suggested reference line 3",
      drawMode: "line",
      points: [
        { xM: scaleX(0.11312227107255168), yM: 0, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: scaleX(0.11312227107255168), yM: scaleY(-1.1), curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-payload",
      role: "part" as const,
      partType: "payload" as const,
      label: "Suggested payload",
      drawMode: "line" as const,
      massKg: payloadKg,
      points: [
        { xM: 0, yM: payloadFrontY, curveMode: "corner" as const },
        { xM: payloadHalfWidthM, yM: payloadFrontY, curveMode: "corner" as const },
        { xM: payloadHalfWidthM, yM: payloadRearY, curveMode: "corner" as const },
        { xM: 0, yM: payloadRearY, curveMode: "corner" as const },
      ],
    },
    {
      id: "sizing-ref-battery",
      role: "part" as const,
      partType: "battery" as const,
      label: "Suggested battery",
      drawMode: "line" as const,
      massKg: batteryMassKg,
      points: [
        { xM: 0, yM: batteryFrontY, curveMode: "corner" as const },
        { xM: batteryHalfWidthM, yM: batteryFrontY, curveMode: "corner" as const },
        { xM: batteryHalfWidthM, yM: batteryRearY, curveMode: "corner" as const },
        { xM: 0, yM: batteryRearY, curveMode: "corner" as const },
      ],
    },
    {
      id: "sizing-ref-tail-boom",
      role: "body",
      label: "Suggested tail boom",
      drawMode: "line",
      points: [
        { xM: scaleX(0.7182473307598398), yM: scaleY(-0.7274270711752431), curveMode: "spline" },
        { xM: scaleX(0.7200134463511801), yM: scaleY(-1.7299034632589383), curveMode: "spline" },
        { xM: scaleX(0.6903118872640711), yM: scaleY(-1.73), curveMode: "spline", segmentInMode: "corner", segmentOutMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-tail",
      role: "liftingSurface",
      liftingSurfaceKind: "tailplane",
      label: "Suggested tailplane",
      drawMode: "line",
      points: [
        { xM: tailMirrorX, yM: tailLeadingY, curveMode: "spline" },
        { xM: tailOuterX, yM: tailLeadingY - tailChord * 0.12, curveMode: "spline" },
        { xM: tailOuterX, yM: tailTrailingY + tailChord * 0.12, curveMode: "spline" },
        { xM: tailMirrorX, yM: tailTrailingY, curveMode: "spline", segmentInMode: "corner", segmentOutMode: "corner" },
      ],
      airfoil: tailAirfoil,
      airfoilStations: { root: tailAirfoil, tip: tailAirfoil },
    },
    {
      id: "sizing-ref-fin",
      role: "liftingSurface",
      liftingSurfaceKind: "fin",
      label: "Suggested fin",
      drawMode: "line",
      sketchViewMode: "side",
      sideViewStationId: "sizing-ref-mirror-plane-1",
      points: [
        { xM: 0, yM: finLeadingY, curveMode: "corner" },
        { xM: finHeight, yM: finLeadingY, curveMode: "corner" },
        { xM: finHeight, yM: finTrailingY, curveMode: "corner" },
        { xM: 0, yM: finTrailingY, curveMode: "corner" },
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
      id: "sizing-ref-motor",
      role: "part" as const,
      partType: "motor" as const,
      label: "Suggested motor",
      drawMode: "line" as const,
      massKg: motorMassKg,
      points: [
        { xM: motorX, yM: motorY, curveMode: "corner" as const },
        { xM: motorX + Math.max(motorDiameter, motorLength), yM: motorY + motorLength * 0.36, curveMode: "corner" as const },
      ],
    },
    {
      id: "sizing-ref-mirror-plane-1",
      role: "mirrorPlane",
      label: "Suggested mirror plane 1",
      drawMode: "line",
      points: [
        { xM: tailMirrorX, yM: tailLeadingY, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: tailMirrorX, yM: tailTrailingY, curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-rotor",
      role: "part" as const,
      partType: "rotor" as const,
      rotorBladeCount,
      label: "Suggested rotor",
      drawMode: "line" as const,
      massKg: rotorMassKg,
      points: [
        { xM: motorX, yM: motorY, curveMode: "corner" as const },
        { xM: motorX + rotorDiameterM / 2, yM: motorY, curveMode: "corner" as const },
      ],
    },
    {
      id: "sizing-ref-reference-line-4",
      role: "referenceLine",
      label: "Suggested reference line 4",
      drawMode: "line",
      points: [
        { xM: scaleX(0.9887518250410188), yM: scaleY(-1.520858046886341), curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: scaleX(0.9887518250410188), yM: scaleY(-1.7), curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
      ],
    },
    {
      id: "sizing-ref-side-mirror-plane-2",
      role: "mirrorPlane",
      label: "Suggested mirror plane 2",
      drawMode: "line",
      sketchViewMode: "side",
      sideViewStationId: "sizing-ref-mirror-plane-1",
      points: [
        { xM: 0, yM: scaleY(-1.7737522935735797), curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
        { xM: 0, yM: scaleY(-1.3784776858410623), curveMode: "corner", segmentInMode: "corner", segmentOutMode: "corner" },
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

export function normalizeSizingGRating(value: unknown) {
  return Math.min(6, Math.max(2, Math.round(numberOr(value, 2))));
}

function structureFractionForGRating(gRating: number) {
  return 0.25 * Math.pow(normalizeSizingGRating(gRating) / 2, 0.6);
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
  const tailGeometry = tailGeometryForArea(tailAreaPerEmpennageM2, maxTailSpanM);
  tailChordM = tailGeometry.chordM;
  return { tailAreaM2, tailArmM, tailChordM, tailSpanM: tailGeometry.spanM };
}

function tailGeometryForArea(areaPerEmpennageM2: number, referenceSpanM: number) {
  const targetAspectRatio = 3.2;
  const idealSpanM = Math.sqrt(areaPerEmpennageM2 * targetAspectRatio);
  const spanM = Math.min(Math.max(idealSpanM, 0.05), Math.max(referenceSpanM, 0.05));
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

export function bestGuessTailVolumeTarget() {
  return 0.55;
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

function planformLengthDriver(draft: ReturnType<typeof computeSizingDraft>) {
  if (draft.totalLengthM <= draft.requestedTotalLengthM + 0.01) return "Length ratio";
  if (draft.fuselageLengthM > draft.requestedTotalLengthM + 0.01) return "Payload/battery pod";
  const minimumTailArmM = Math.max(draft.meanChordM * 1.35, draft.rotorDiameterM * 0.46);
  if (draft.tailArmM <= minimumTailArmM + 0.01) return "Tail arm minimum";
  return "Tail volume";
}

function SizingMetric({ label, value }: { label: string; value: string }) {
  return (
    <Metric
      info={sizingMetricInfo[label]}
      label={label}
      value={value}
    />
  );
}

function formatPower(valueW: number) {
  if (Math.abs(valueW) >= 1000) return `${(valueW / 1000).toFixed(1)} kW`;
  return `${valueW.toFixed(0)} W`;
}
