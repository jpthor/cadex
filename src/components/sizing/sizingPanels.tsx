import { Gauge } from "lucide-react";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { computeSizingAnalysis } from "../../sizing/auditedSizingEngine";
import { fixedAircraftMotorCount, metersPerSecondPerKnot } from "../../app/constants";
import type { SizingProject } from "../../sizing";
import { defaultTurbineCount, turbineEngineOptions } from "../../sketch/constants";
import { Metric } from "../ui/Metric";
import { PropulsionNumberField } from "../propulsion/fields";


export function SizingDashboard({
  analysis,
  project,
  onOpenSketch,
  onProjectChange,
}: {
  analysis?: ReturnType<typeof computeSizingAnalysis>;
  project: SizingProject;
  onOpenSketch: () => void;
  onProjectChange: (next: SizingProject) => void;
}) {
  const [computedDraft, setComputedDraft] = useState<ReturnType<typeof computeSizingDraft> | null>(null);
  const hardwarePick = computedDraft?.hardware ?? null;
  function updateMission(patch: Partial<SizingProject["mission"]>) {
    setComputedDraft(null);
    onProjectChange({ ...project, mission: { ...project.mission, ...patch } });
  }
  const updateEnginePayload = useCallback((payloadKg: number) => {
    if (project.mission.payloadKg === payloadKg) return;
    updateMission({ payloadKg });
  }, [project]);
  function computeDraft() {
    setComputedDraft(computeSizingDraft(project));
  }
  function copyToSketch() {
    if (!computedDraft) return;
    onProjectChange({
      ...project,
      sizingReferenceShapes: computedDraft.shapes,
      showSizingReference: true,
    });
    onOpenSketch();
  }
  return (
    <main className="sizing-dashboard">
      <SizingJetComputePanel onPayloadChange={updateEnginePayload} />
      <section className="sizing-dashboard-panel sizing-dashboard-requirements">
        <h2>Twin tailsitter requirements</h2>
        <p className="dashboard-muted">Electric VTOL, 2 rotors, 2 motors, dual empennage surfaces in rotor wake.</p>
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
        <button className="primary-dashboard-action" onClick={computeDraft} type="button">
          Compute
        </button>
        {computedDraft ? (
          <button className="secondary-dashboard-action" onClick={copyToSketch} type="button">
            Copy to Sketch
          </button>
        ) : null}
      </section>
      <section className="sizing-dashboard-panel sizing-dashboard-data">
        <h2>Suggested Aircraft</h2>
        {computedDraft ? (
          <>
            <SizingDataGroup title="Mass">
              <Metric label="Estimated mass" value={`${computedDraft.massKg.toFixed(2)} kg`} />
              <Metric label="Payload" value={`${computedDraft.payloadKg.toFixed(2)} kg`} />
              <Metric label="Structure" value={`${computedDraft.structureMassKg.toFixed(2)} kg`} />
              <Metric label="Motors + rotors" value={`${(computedDraft.motorMassKg + computedDraft.rotorMassKg).toFixed(2)} kg`} />
              <Metric label="Example battery mass" value={`${computedDraft.batteryMassKg.toFixed(2)} kg`} />
              <Metric label="Energy required" value={`${computedDraft.batteryEnergyWh.toFixed(0)} Wh`} />
              <Metric label="Electronics" value={`${computedDraft.electronicsMassKg.toFixed(2)} kg`} />
            </SizingDataGroup>
            <SizingDataGroup title="Wing">
              <Metric label="Total width" value={`${computedDraft.totalWidthM.toFixed(2)} m`} />
              <Metric label="Total length" value={`${computedDraft.totalLengthM.toFixed(2)} m`} />
              <Metric label="Wing area" value={`${computedDraft.wingAreaM2.toFixed(3)} m2`} />
              <Metric label="Wingspan" value={`${computedDraft.wingSpanM.toFixed(2)} m`} />
              <Metric label="Wing chord" value={`${computedDraft.meanChordM.toFixed(3)} m`} />
              <Metric label="Aspect ratio" value={`${computedDraft.aspectRatio.toFixed(1)}`} />
              <Metric label="Suggested aerofoil" value={computedDraft.wingAirfoil} />
              <Metric label="Design cruise CL" value={`${computedDraft.cruiseLiftCoefficient.toFixed(2)}`} />
            </SizingDataGroup>
            <SizingDataGroup title="Tail">
              <Metric label="Tail area total" value={`${computedDraft.tailAreaM2.toFixed(3)} m2`} />
              <Metric label="Tail area / empennage" value={`${computedDraft.tailAreaPerEmpennageM2.toFixed(3)} m2`} />
              <Metric label="Tail arm" value={`${computedDraft.tailArmM.toFixed(2)} m`} />
              <Metric label="Vertical fins" value="2" />
              <Metric label="Fin area / fin" value={`${computedDraft.finAreaPerFinM2.toFixed(3)} m2`} />
              <Metric label="Fin height x chord" value={`${computedDraft.finHeightM.toFixed(2)} m x ${computedDraft.finChordM.toFixed(2)} m`} />
              <Metric label="Tail volume ratio" value={`${computedDraft.tailVolumeRatio.toFixed(2)} unitless`} />
            </SizingDataGroup>
            <SizingDataGroup title="Power & Propulsion">
              <Metric label="Hover power" value={`${computedDraft.hoverPowerTotalW.toFixed(0)} W total`} />
              <Metric label="Cruise power" value={`${computedDraft.cruisePowerW.toFixed(0)} W`} />
              <Metric label="Motor power" value={`${computedDraft.powerPerMotorW.toFixed(0)} W each`} />
              <Metric label="Rotor blades" value={`${computedDraft.rotorBladeCount}`} />
              <Metric label="Rotor diameter" value={`${(computedDraft.rotorDiameterM * 1000).toFixed(0)} mm actual`} />
              <Metric label="Disk loading" value={`${computedDraft.actualDiskLoadingNpm2.toFixed(0)} N/m2 actual`} />
            </SizingDataGroup>
            <SizingDataGroup title="Checks">
              <Metric label="Ideal low-disk rotor" value={`${(computedDraft.idealRotorDiameterM * 1000).toFixed(0)} mm`} />
              <Metric label="Thrust margin" value={`${computedDraft.thrustMarginPct.toFixed(0)}% over target`} />
              <Metric label="Battery margin" value={`${computedDraft.batteryMarginPct.toFixed(0)}% over required`} />
              <Metric label="Wing loading" value={`${computedDraft.wingLoadingKgM2.toFixed(1)} kg/m2`} />
              <Metric label="Stall speed" value={`${msToKnots(computedDraft.stallSpeedMS).toFixed(0)} kt`} />
            </SizingDataGroup>
            <SizingDataGroup title="Assumptions">
              <Metric label="Configuration" value="electric twin-rotor tailsitter" />
              <Metric label="Build" value="carbon fibre shell / spar" />
              <Metric label="Empennage" value="dual tail surfaces + 2 fins" />
              <Metric label="Cruise L/D" value={`${computedDraft.cruiseLiftToDrag.toFixed(1)}`} />
              <Metric label="Hover figure of merit" value={`${computedDraft.hoverFigureOfMerit.toFixed(2)}`} />
              <Metric label="Structure factor" value={`${(computedDraft.structureFraction * 100).toFixed(0)}% of installed mass`} />
            </SizingDataGroup>
            {hardwarePick ? (
              <SizingDataGroup title="Example Hardware">
                <Metric label="Motor x2" value={hardwarePick.motor.name} />
                <Metric label="Motor size / mass" value={`${hardwarePick.motor.dimensionsMm} / ${hardwarePick.motor.massKg.toFixed(2)} kg ea`} />
                <Metric label="Rotor x2" value={hardwarePick.rotor.name} />
                <Metric label="Rotor size / mass" value={`${hardwarePick.rotor.dimensionsMm} / ${hardwarePick.rotorMassPerAssemblyKg.toFixed(2)} kg ea`} />
              <Metric label="Battery" value={hardwarePick.battery.name} />
              <Metric label="Battery size / mass" value={`${hardwarePick.battery.dimensionsMm} / ${hardwarePick.battery.massKg.toFixed(2)} kg`} />
              <Metric label="Fuselage package" value={`${(computedDraft.fuselageLengthM * 1000).toFixed(0)} x ${(computedDraft.fuselageWidthM * 1000).toFixed(0)} mm`} />
              <Metric label="Datasheet thrust" value={`${hardwarePick.motor.maxThrustKg.toFixed(1)} kg max each`} />
                <Metric label="Hover load" value={`${hardwarePick.hoverLoadKg.toFixed(1)} kg each`} />
                <Metric label="Takeoff target" value={`${hardwarePick.takeoffTargetKg.toFixed(1)} kg each`} />
                <Metric label="Hardware mass" value={`${hardwarePick.totalHardwareMassKg.toFixed(2)} kg`} />
              </SizingDataGroup>
            ) : null}
            <SizingAircraftPreview draft={computedDraft} />
          </>
        ) : (
          <p className="dashboard-muted">Press Compute to show suggested aircraft parameters.</p>
        )}
      </section>
    </main>
  );
}

export function SizingJetComputePanel({ onPayloadChange }: { onPayloadChange: (payloadKg: number) => void }) {
  const [engineId, setEngineId] = useState("swiwin-sw60b");
  const [enduranceMin, setEnduranceMin] = useState(20);
  const selectedEngine = turbineEngineOptions.find((engine) => engine.id === engineId) ?? turbineEngineOptions[0];
  const safeEnduranceMin = Number.isFinite(enduranceMin) ? Math.max(0, enduranceMin) : 0;
  const engineWeightKg = selectedEngine.engineWeightKg * defaultTurbineCount;
  const fuelWeightKg = selectedEngine.fuelKgPerMin * safeEnduranceMin * defaultTurbineCount;
  const totalWeightKg = engineWeightKg + fuelWeightKg;
  const roundedPayloadKg = Math.ceil(totalWeightKg);

  return (
    <section className="sizing-dashboard-panel sizing-dashboard-engine engine-compute-panel">
      <h2>Engine Payload</h2>
      <label className="propulsion-field">
        <span>Engine</span>
        <div>
          <select value={engineId} onChange={(event) => setEngineId(event.target.value)}>
            {turbineEngineOptions.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.maker} {engine.model} - {engine.thrustN} N
              </option>
            ))}
          </select>
        </div>
      </label>
      <PropulsionNumberField label="Endurance time" suffix="min" step={1} value={enduranceMin} onChange={setEnduranceMin} />
      <div className="engine-compute-spec">
        <span>{selectedEngine.maker} {selectedEngine.model}</span>
        <strong>{selectedEngine.thrustN * defaultTurbineCount} N total thrust</strong>
      </div>
      <Metric label="Engine weight x2" value={`${engineWeightKg.toFixed(2)} kg`} />
      <Metric label="Fuel weight x2" value={`${fuelWeightKg.toFixed(2)} kg`} />
      <div className="metric-tile engine-compute-total">
        <span>Total weight</span>
        <strong>{totalWeightKg.toFixed(2)} kg</strong>
      </div>
      <button className="secondary-dashboard-action" onClick={() => onPayloadChange(roundedPayloadKg)} type="button">
        Use as Payload
      </button>
      <p className="engine-compute-note">Fuel uses full-power published burn where available. Source: {selectedEngine.source}.</p>
    </section>
  );
}

function SizingDataGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="sizing-data-group">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

function SizingAircraftPreview({ draft }: { draft: ReturnType<typeof computeSizingDraft> }) {
  const width = 860;
  const height = 430;
  const halfWidthM = draft.totalWidthM / 2;
  const wingHalfSpanM = draft.wingSpanM / 2;
  const noseY = draft.fuselageLengthM / 2;
  const fuselageTailY = -draft.fuselageLengthM / 2;
  const wingLeadingY = draft.meanChordM * 0.5;
  const wingTrailingY = -draft.meanChordM * 0.5;
  const tailY = -draft.tailArmM;
  const tailSpanM = Math.sqrt(draft.tailAreaPerEmpennageM2 * 3.2);
  const tailChordM = draft.tailAreaPerEmpennageM2 / Math.max(tailSpanM, 0.01);
  const motorY = draft.meanChordM * 0.05;
  const motorX = Math.max(draft.fuselageWidthM / 2 + draft.rotorDiameterM / 2 + 0.04, wingHalfSpanM - draft.rotorDiameterM / 2 - 0.04);
  const minX = -halfWidthM - 0.25;
  const maxX = halfWidthM + 0.25;
  const minY = tailY - tailChordM - 0.45;
  const maxY = noseY + 0.35;
  const scale = Math.min(width / Math.max(maxX - minX, 0.1), height / Math.max(maxY - minY, 0.1));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const x = (value: number) => offsetX + (value - minX) * scale;
  const y = (value: number) => offsetY + (maxY - value) * scale;
  const lineLabel = (label: string, x1: number, y1: number, x2: number, y2: number) => (
    <g className="sizing-preview-dim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 7}>{label}</text>
    </g>
  );
  const wingPath = `${x(-wingHalfSpanM)},${y(wingLeadingY)} ${x(wingHalfSpanM)},${y(wingLeadingY * 0.84)} ${x(wingHalfSpanM)},${y(wingTrailingY * 0.96)} ${x(-wingHalfSpanM)},${y(wingTrailingY)}`;
  const fuselagePath = `${x(-draft.fuselageWidthM / 2)},${y(noseY)} ${x(draft.fuselageWidthM / 2)},${y(noseY)} ${x(draft.fuselageWidthM / 2)},${y(fuselageTailY)} ${x(-draft.fuselageWidthM / 2)},${y(fuselageTailY)}`;
  const tailSurface = (side: -1 | 1) => {
    const cx = side * motorX;
    return `${x(cx - side * tailSpanM / 2)},${y(tailY + tailChordM * 0.5)} ${x(cx + side * tailSpanM / 2)},${y(tailY + tailChordM * 0.45)} ${x(cx + side * tailSpanM / 2)},${y(tailY - tailChordM * 0.45)} ${x(cx - side * tailSpanM / 2)},${y(tailY - tailChordM * 0.5)}`;
  };
  const fin = (side: -1 | 1) => {
    const cx = side * motorX;
    const finHalfChord = draft.finChordM / 2;
    const finHalfWidth = Math.max(draft.finHeightM * 0.08, 0.025);
    return `${x(cx - finHalfWidth)},${y(tailY + finHalfChord)} ${x(cx + finHalfWidth)},${y(tailY + finHalfChord)} ${x(cx + finHalfWidth)},${y(tailY - finHalfChord)} ${x(cx - finHalfWidth)},${y(tailY - finHalfChord)}`;
  };
  const rotorBlades = (side: -1 | 1) => {
    const cx = x(side * motorX);
    const cy = y(motorY);
    const bladeLengthPx = draft.rotorDiameterM * scale;
    const bladeAngles = draft.rotorBladeCount === 3 ? [0, 120, 240] : draft.rotorBladeCount === 4 ? [0, 90, 180, 270] : [0, 180];
    return (
      <g className="sizing-preview-rotor" transform={`translate(${cx} ${cy})`}>
        {bladeAngles.map((angle) => (
          <line
            key={angle}
            className="sizing-preview-rotor-blade"
            x1={0}
            y1={0}
            x2={(bladeLengthPx / 2) * Math.cos((angle * Math.PI) / 180)}
            y2={(bladeLengthPx / 2) * Math.sin((angle * Math.PI) / 180)}
          />
        ))}
      </g>
    );
  };

  return (
    <div className="sizing-preview">
      <div className="sizing-preview-header">
        <h3>Aircraft sketch</h3>
        <span>top down, key dimensions</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Top down aircraft sizing sketch">
        <defs>
          <marker id="sizing-preview-arrow" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
            <path d="M0,0 L6,3 L0,6 Z" />
          </marker>
        </defs>
        <g className="sizing-preview-grid">
          {Array.from({ length: 9 }, (_, index) => (
            <line key={`v-${index}`} x1={(width / 8) * index} y1="0" x2={(width / 8) * index} y2={height} />
          ))}
          {Array.from({ length: 5 }, (_, index) => (
            <line key={`h-${index}`} x1="0" y1={(height / 4) * index} x2={width} y2={(height / 4) * index} />
          ))}
        </g>
        <polygon className="sizing-preview-wing" points={wingPath} />
        <polygon className="sizing-preview-body" points={fuselagePath} />
        <line className="sizing-preview-boom" x1={x(-motorX)} y1={y(motorY)} x2={x(-motorX)} y2={y(tailY - tailChordM * 0.8)} />
        <line className="sizing-preview-boom" x1={x(motorX)} y1={y(motorY)} x2={x(motorX)} y2={y(tailY - tailChordM * 0.8)} />
        <polygon className="sizing-preview-tail" points={tailSurface(-1)} />
        <polygon className="sizing-preview-tail" points={tailSurface(1)} />
        <polygon className="sizing-preview-fin" points={fin(-1)} />
        <polygon className="sizing-preview-fin" points={fin(1)} />
        {([-1, 1] as const).map((side) => (
          <g key={side}>
            {rotorBlades(side)}
            <circle className="sizing-preview-motor" cx={x(side * motorX)} cy={y(motorY)} r={Math.max(4, draft.meanChordM * scale * 0.07)} />
          </g>
        ))}
        <line className="sizing-preview-centerline" x1={x(0)} y1={y(maxY)} x2={x(0)} y2={y(minY)} />
        {lineLabel(`total width ${draft.totalWidthM.toFixed(2)} m`, x(-halfWidthM), y(minY + 0.08), x(halfWidthM), y(minY + 0.08))}
        {lineLabel(`length ${draft.totalLengthM.toFixed(2)} m`, x(maxX - 0.08), y(noseY), x(maxX - 0.08), y(tailY - tailChordM))}
        {lineLabel(`span ${draft.wingSpanM.toFixed(2)} m`, x(-wingHalfSpanM), y(wingLeadingY + 0.14), x(wingHalfSpanM), y(wingLeadingY + 0.14))}
        {lineLabel(`chord ${draft.meanChordM.toFixed(2)} m`, x(-wingHalfSpanM - 0.12), y(wingLeadingY), x(-wingHalfSpanM - 0.12), y(wingTrailingY))}
        {lineLabel(`rotor ${draft.rotorDiameterM.toFixed(2)} m`, x(motorX - draft.rotorDiameterM / 2), y(motorY - draft.rotorDiameterM / 2 - 0.08), x(motorX + draft.rotorDiameterM / 2), y(motorY - draft.rotorDiameterM / 2 - 0.08))}
        {lineLabel(`tail arm ${draft.tailArmM.toFixed(2)} m`, x(0.12), y(0), x(0.12), y(tailY))}
        <text className="sizing-preview-note" x={x(-halfWidthM)} y={y(maxY - 0.1)}>2 fins, {draft.rotorBladeCount}-blade rotors, {draft.wingAirfoil}</text>
      </svg>
    </div>
  );
}

type HardwareMotor = {
  dimensionsMm: string;
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
  lengthM: number;
  massKg: number;
  name: string;
  source: string;
  widthM: number;
};

const actualHardwarePairs: Array<{ motor: HardwareMotor; rotor: HardwareRotor }> = [
  {
    motor: {
      dimensionsMm: "100 x 60 mm",
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
      dimensionsMm: "147.5 x 55 mm",
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
    lengthM: 0.182,
    massKg: 2.8,
    name: "Tattu 12S 10Ah 30C",
    source: "Tattu 12S LiPo series datasheet",
    widthM: 0.067,
  },
  {
    dimensionsMm: "191 x 78 x 130 mm",
    energyWh: 710.4,
    lengthM: 0.191,
    massKg: 4.0,
    name: "Tattu 12S 16Ah 30C",
    source: "Tattu 12S LiPo series datasheet",
    widthM: 0.078,
  },
  {
    dimensionsMm: "206 x 93 x 119 mm",
    energyWh: 976.8,
    lengthM: 0.206,
    massKg: 4.65,
    name: "Tattu 12S 22Ah 30C",
    source: "Tattu 12S LiPo series datasheet",
    widthM: 0.093,
  },
];

function selectActualHardwareFor({
  energyRequiredWh,
  rotorBladeCount,
  takeoffTargetKg,
}: {
  energyRequiredWh: number;
  rotorBladeCount: number;
  takeoffTargetKg: number;
}) {
  const thrustTargetKg = Math.max(takeoffTargetKg * 1.15, takeoffTargetKg + 1);
  const pair = actualHardwarePairs.find((candidate) => candidate.motor.maxThrustKg >= thrustTargetKg) ?? actualHardwarePairs[actualHardwarePairs.length - 1];
  const rotor = equivalentRotorForBladeCount(pair.rotor, rotorBladeCount);
  const energyTargetWh = energyRequiredWh * batterySelectionMargin;
  const battery = actualBatteryPicks.find((candidate) => candidate.energyWh >= energyTargetWh) ?? actualBatteryPicks[actualBatteryPicks.length - 1];
  const rotorMassPerAssemblyKg = rotor.bladeMassKg * rotorBladeCount;
  return {
    battery,
    motor: pair.motor,
    rotor,
    rotorMassPerAssemblyKg,
    sources: [pair.motor.source, rotor.source, battery.source],
    totalHardwareMassKg: pair.motor.massKg * fixedAircraftMotorCount + rotorMassPerAssemblyKg * fixedAircraftMotorCount + battery.massKg,
  };
}

const batterySelectionMargin = 1.2;
const baselineRotorBladeCount = 2;
const propDiameterThrustExponent = 0.25;
const propMassDiameterExponent = 2.15;

function equivalentRotorForBladeCount(rotor: HardwareRotor, rotorBladeCount: number): HardwareRotor {
  const bladeCount = normalizeSizingRotorBladeCount(rotorBladeCount);
  if (bladeCount === baselineRotorBladeCount) return rotor;
  const diameterScale = Math.pow(baselineRotorBladeCount / bladeCount, propDiameterThrustExponent);
  const diameterIn = rotor.diameterIn * diameterScale;
  const pitchIn = rotor.pitchIn * diameterScale;
  const bladeMassKg = rotor.bladeMassKg * Math.pow(diameterScale, propMassDiameterExponent);
  return {
    ...rotor,
    bladeMassKg,
    diameterIn,
    dimensionsMm: `${diameterIn.toFixed(1)} x ${pitchIn.toFixed(1)} in est.`,
    name: `${bladeCount}-blade ${rotor.name} equivalent`,
    pitchIn,
    source: `${rotor.source}; ${bladeCount}-blade diameter estimated from blade-count scaling`,
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
  const idealDiskLoadingNpm2 = bestGuessDiskLoadingNpm2({ cruiseSpeedMS, enduranceMin, hoverTimeMin });
  const cruiseLiftCoefficient = bestGuessCruiseLiftCoefficient({ cruiseSpeedMS });
  const wingAirfoil = suggestWingAirfoil({ cruiseLiftCoefficient, cruiseSpeedMS });
  const tailVolumeRatio = bestGuessTailVolumeTarget({ hoverTimeMin });
  const rhoKgM3 = 1.225;
  const hoverFigureOfMerit = hoverFigureOfMeritForBladeCount(rotorBladeCount);
  const cruiseLiftToDrag = 8.2;
  const cruisePropulsiveEfficiency = 0.72;
  const aspectRatio = 4.8;
  const compactWingLoadingTargetKgM2 = 28;
  const structureFraction = 0.25;
  const electronicsMassKg = 0.9;
  let massKg = Math.max(payloadKg / 0.22, payloadKg + 2.5);
  let wingAreaM2 = 0.1;
  let wingSpanM = 0.1;
  let meanChordM = 0.1;
  let rotorDiameterM = 0.1;
  let idealRotorDiameterM = 0.1;
  let actualDiskLoadingNpm2 = 0;
  let hoverPowerTotalW = 0;
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
    wingAreaM2 = Math.min(liftSizedWingAreaM2, massKg / compactWingLoadingTargetKgM2);
    actualCruiseLiftCoefficient = weightN / Math.max(0.5 * rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS * wingAreaM2, 1);
    wingSpanM = Math.sqrt(wingAreaM2 * aspectRatio);
    meanChordM = wingAreaM2 / Math.max(wingSpanM, 0.01);
    const thrustPerMotorN = (weightN * takeoffThrustToWeight) / motorCount;
    hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
    rotorDiameterM = hardware.rotor.diameterIn * 0.0254;
    idealRotorDiameterM = 2 * Math.sqrt(thrustPerMotorN / idealDiskLoadingNpm2 / Math.PI);
    const rotorDiskAreaPerMotorM2 = Math.PI * Math.pow(rotorDiameterM / 2, 2);
    const totalRotorDiskAreaM2 = motorCount * rotorDiskAreaPerMotorM2;
    actualDiskLoadingNpm2 = thrustPerMotorN / Math.max(rotorDiskAreaPerMotorM2, 0.001);
    hoverPowerTotalW = Math.pow(weightN, 1.5) / Math.sqrt(2 * rhoKgM3 * totalRotorDiskAreaM2) / hoverFigureOfMerit;
    cruisePowerW = (weightN / cruiseLiftToDrag) * cruiseSpeedMS / cruisePropulsiveEfficiency;
    batteryEnergyWh = (hoverPowerTotalW * (hoverTimeMin / 60) + cruisePowerW * (enduranceMin / 60)) * reserveFactor;
    hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
    batteryMassKg = hardware.battery.massKg;
    motorMassKg = hardware.motor.massKg * motorCount;
    rotorMassKg = hardware.rotorMassPerAssemblyKg * motorCount;
    structureMassKg = Math.max(0.7, (payloadKg + batteryMassKg + motorMassKg + rotorMassKg + electronicsMassKg) * structureFraction);
    const nextMassKg = payloadKg + batteryMassKg + motorMassKg + rotorMassKg + electronicsMassKg + structureMassKg;
    massKg = massKg * 0.45 + nextMassKg * 0.55;
  }
  const totalThrustN = massKg * 9.80665 * takeoffThrustToWeight;
  const thrustPerMotorN = totalThrustN / motorCount;
  hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
  rotorDiameterM = hardware.rotor.diameterIn * 0.0254;
  idealRotorDiameterM = 2 * Math.sqrt(thrustPerMotorN / idealDiskLoadingNpm2 / Math.PI);
  const rotorDiskAreaPerMotorM2 = Math.PI * Math.pow(rotorDiameterM / 2, 2);
  actualDiskLoadingNpm2 = thrustPerMotorN / Math.max(rotorDiskAreaPerMotorM2, 0.001);
  const finalWeightN = massKg * 9.80665;
  const finalTotalRotorDiskAreaM2 = motorCount * rotorDiskAreaPerMotorM2;
  hoverPowerTotalW = Math.pow(finalWeightN, 1.5) / Math.sqrt(2 * rhoKgM3 * finalTotalRotorDiskAreaM2) / hoverFigureOfMerit;
  cruisePowerW = (finalWeightN / cruiseLiftToDrag) * cruiseSpeedMS / cruisePropulsiveEfficiency;
  batteryEnergyWh = (hoverPowerTotalW * (hoverTimeMin / 60) + cruisePowerW * (enduranceMin / 60)) * reserveFactor;
  hardware = selectActualHardwareFor({ energyRequiredWh: batteryEnergyWh, rotorBladeCount, takeoffTargetKg: thrustPerMotorN / 9.80665 });
  batteryMassKg = hardware.battery.massKg;
  motorMassKg = hardware.motor.massKg * motorCount;
  rotorMassKg = hardware.rotorMassPerAssemblyKg * motorCount;
  const finalLiftSizedWingAreaM2 = finalWeightN / Math.max(0.5 * rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS * cruiseLiftCoefficient, 1);
  wingAreaM2 = Math.min(finalLiftSizedWingAreaM2, massKg / compactWingLoadingTargetKgM2);
  actualCruiseLiftCoefficient = finalWeightN / Math.max(0.5 * rhoKgM3 * cruiseSpeedMS * cruiseSpeedMS * wingAreaM2, 1);
  const rotorInsideWingMarginM = 0.08;
  const rotorContainmentSpanM = rotorDiameterM * 2 + Math.max(hardware.battery.widthM, 0.06) + rotorInsideWingMarginM * 2;
  wingSpanM = Math.max(Math.sqrt(wingAreaM2 * aspectRatio), rotorContainmentSpanM);
  meanChordM = wingAreaM2 / Math.max(wingSpanM, 0.01);
  const finalWingAirfoil = suggestWingAirfoil({ cruiseLiftCoefficient: actualCruiseLiftCoefficient, cruiseSpeedMS });
  const powerPerMotorW = hoverPowerTotalW / motorCount;
  const tailArmM = Math.max(meanChordM * 1.35, rotorDiameterM * 0.46);
  const tailAreaM2 = (tailVolumeRatio * wingAreaM2 * meanChordM) / Math.max(tailArmM, 0.1);
  const tailAreaPerEmpennageM2 = tailAreaM2 / 2;
  const tailSpanPerEmpennageM = Math.sqrt(tailAreaPerEmpennageM2 * 3.2);
  const tailChordM = tailAreaPerEmpennageM2 / Math.max(tailSpanPerEmpennageM, 0.01);
  fuselageLengthM = Math.max(hardware.battery.lengthM + 0.08, 0.24);
  fuselageWidthM = Math.max(hardware.battery.widthM + 0.06, 0.12);
  const motorX = wingSpanM / 2 - rotorDiameterM / 2 - rotorInsideWingMarginM;
  const totalWidthM = wingSpanM;
  const totalLengthM = Math.max(fuselageLengthM, meanChordM) / 2 + tailArmM + tailChordM;
  const finAreaTotalM2 = wingAreaM2 * 0.2;
  const finAreaPerFinM2 = finAreaTotalM2 / 2;
  const finHeightM = Math.sqrt(finAreaPerFinM2 * 1.35);
  const finChordM = finAreaPerFinM2 / Math.max(finHeightM, 0.01);
  const wingLoadingKgM2 = massKg / Math.max(wingAreaM2, 0.01);
  const actualAspectRatio = Math.pow(wingSpanM, 2) / Math.max(wingAreaM2, 0.01);
  const stallSpeedMS = Math.sqrt((2 * massKg * 9.80665) / (rhoKgM3 * Math.max(wingAreaM2, 0.01) * 1.35));
  const batteryMarginPct = ((hardware.battery.energyWh / Math.max(batteryEnergyWh, 1)) - 1) * 100;
  const takeoffTargetKg = thrustPerMotorN / 9.80665;
  const thrustMarginPct = ((hardware.motor.maxThrustKg / Math.max(takeoffTargetKg, 0.1)) - 1) * 100;
  const hardwareWithLoads = {
    ...hardware,
    hoverLoadKg: massKg / motorCount,
    takeoffTargetKg,
  };
  return {
    actualDiskLoadingNpm2,
    aspectRatio: actualAspectRatio,
    batteryEnergyWh,
    batteryMarginPct,
    batteryMassKg,
    cruiseLiftCoefficient: actualCruiseLiftCoefficient,
    cruiseLiftToDrag,
    cruisePowerW,
    diskLoadingNpm2: idealDiskLoadingNpm2,
    electronicsMassKg,
    finAreaPerFinM2,
    finChordM,
    finHeightM,
    fuselageLengthM,
    fuselageWidthM,
    hardware: hardwareWithLoads,
    hoverPowerTotalW,
    hoverFigureOfMerit,
    idealRotorDiameterM,
    massKg,
    meanChordM,
    motorMassKg,
    powerPerMotorW,
    payloadKg,
    rotorBladeCount,
    rotorDiameterM,
    rotorMassKg,
    stallSpeedMS,
    structureMassKg,
    structureFraction,
    tailAreaPerEmpennageM2,
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
    wingLoadingKgM2,
    wingSpanM,
    shapes: sizingDraftReferenceShapes({ fuselageLengthM, fuselageWidthM, wingAreaM2, wingSpanM, meanChordM, tailAreaM2, tailArmM, rotorDiameterM, rotorBladeCount }),
  };
}

export function sizingDraftReferenceShapes({
  fuselageLengthM,
  fuselageWidthM,
  meanChordM,
  rotorDiameterM,
  rotorBladeCount,
  tailAreaM2,
  tailArmM,
  wingAreaM2,
  wingSpanM,
}: {
  fuselageLengthM: number;
  fuselageWidthM: number;
  meanChordM: number;
  rotorDiameterM: number;
  rotorBladeCount: number;
  tailAreaM2: number;
  tailArmM: number;
  wingAreaM2: number;
  wingSpanM: number;
}): SizingProject["shapes"] {
  const halfSpan = wingSpanM / 2;
  const tailAreaPerEmpennageM2 = tailAreaM2 / 2;
  const tailSpan = Math.sqrt(tailAreaPerEmpennageM2 * 3.2);
  const tailChord = tailAreaPerEmpennageM2 / Math.max(tailSpan, 0.01);
  const tailY = -tailArmM;
  const motorY = meanChordM * 0.05;
  const motorX = Math.max(fuselageWidthM / 2 + rotorDiameterM / 2 + 0.04, halfSpan - rotorDiameterM / 2 - 0.08);
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
    },
    {
      id: "sizing-ref-motor",
      role: "part" as const,
      partType: "motor" as const,
      label: "Sizing motor",
      drawMode: "line" as const,
      points: [
        { xM: motorX, yM: motorY - rotorDiameterM * 0.12, curveMode: "corner" as const },
        { xM: motorX, yM: motorY + rotorDiameterM * 0.12, curveMode: "corner" as const },
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
        { xM: Math.max(0, motorX - rotorDiameterM / 2), yM: motorY, curveMode: "corner" as const },
        { xM: motorX + rotorDiameterM / 2, yM: motorY, curveMode: "corner" as const },
      ],
    },
  ];
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

export function bestGuessDiskLoadingNpm2({
  cruiseSpeedMS,
  enduranceMin,
  hoverTimeMin,
}: {
  cruiseSpeedMS: number;
  enduranceMin: number;
  hoverTimeMin: number;
}) {
  const enduranceBias = enduranceMin >= 20 ? -10 : enduranceMin <= 10 ? 12 : 0;
  const hoverBias = hoverTimeMin >= 3 ? -8 : 0;
  const speedBias = cruiseSpeedMS > 24 ? 10 : cruiseSpeedMS < 14 ? -5 : 0;
  return clampNumber(70 + enduranceBias + hoverBias + speedBias, 45, 120);
}

export function bestGuessCruiseLiftCoefficient({ cruiseSpeedMS }: { cruiseSpeedMS: number }) {
  const speedBias = cruiseSpeedMS > 24 ? -0.04 : cruiseSpeedMS < 14 ? 0.04 : 0;
  return clampNumber(0.66 + speedBias, 0.56, 0.76);
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

export function bestGuessTailVolumeTarget({ hoverTimeMin }: { hoverTimeMin: number }) {
  return hoverTimeMin >= 3 ? 1.05 : 0.95;
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
