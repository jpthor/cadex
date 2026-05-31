import { Gauge, SlidersHorizontal } from "lucide-react";
import type { ComponentProps } from "react";
import type { PropulsionTabState } from "../../app/types";
import { batterySamples, motorSamples } from "../../propulsionEngine";
import { computeJetComparison } from "../../jetEngine";
import type { IJetCommandMixPoint } from "../../jetEngine";
import type { SizingProject } from "../../sizing";
import { Metric, MetricTile, ResultGroup } from "../ui/Metric";
import { jetMetricInfo } from "./jetMetricInfo";

function jetInfoFor(label: string) {
  const normalized = label.replace(/\s+\([^)]*\)/g, "");
  return jetMetricInfo[label] ?? jetMetricInfo[normalized];
}

function JetMetric({ info, label, ...rest }: ComponentProps<typeof Metric>) {
  return <Metric {...rest} info={info ?? jetInfoFor(label)} label={label} />;
}

function JetMetricTile({ info, label, ...rest }: ComponentProps<typeof MetricTile>) {
  return <MetricTile {...rest} info={info ?? jetInfoFor(label)} label={label} />;
}

export function IJetDashboard({
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  propulsionState,
  sizingProject,
}: {
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  propulsionState: PropulsionTabState;
  sizingProject: SizingProject;
}) {
  const comparison = computeJetComparison({
    aircraftMassKg,
    batteryEnergyDensityWhKg,
    propulsionState,
    sizingProject,
  });
  const endurance = comparison.enduranceAssistBest;
  const selectedMotor = motorSamples.find((motor) => motor.id === propulsionState.selectedMotorId) ?? motorSamples[0];
  const selectedBattery = batterySamples.find((battery) => battery.id === propulsionState.selectedBatteryId) ?? batterySamples[0];
  const packCurrentLimitA = selectedBattery.capacityAh * selectedBattery.cRating;
  const splitRatio = endurance.propCommandPct > 0 ? endurance.commandPct / endurance.propCommandPct : 0;
  const commandCurve = comparison.iJetOptimizedCommandCurve;
  const propCapPct = commandCurve[commandCurve.length - 1]?.baselinePropCommandPct ?? 100;
  const jetAtPropCapPct = Math.min(100, propCapPct * splitRatio);
  const proofRows = commandCurve.filter((point) => point.masterCommandPct > 0);
  const bestEndurancePoint = proofRows.reduce((best, point) => (point.enduranceMin > best.enduranceMin ? point : best), proofRows[0] ?? commandCurve[0]);
  const bestRangePoint = proofRows.reduce((best, point) => (point.rangeNm > best.rangeNm ? point : best), proofRows[0] ?? commandCurve[0]);
  const bestEnduranceGain = Math.max(...proofRows.map((point) => point.enduranceGainPct ?? 0));
  const bestRangeGain = Math.max(...proofRows.map((point) => point.rangeGainPct ?? 0));
  const averageEnduranceGain = proofRows.reduce((sum, point) => sum + (point.enduranceGainPct ?? 0), 0) / Math.max(proofRows.length, 1);

  return (
    <main className="propulsion-workspace jet-workspace ijet-workspace">
      <section className="propulsion-panel">
        <div className="propulsion-title">
          <SlidersHorizontal size={20} />
          <h2>iJet Command Mixer</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Compares your fixed endurance split against an optimized mix. Each row must meet or beat the fixed split thrust, then the solver picks the prop/jet blend with the best endurance and range.
        </p>
        <div className="ijet-best-summary">
          <div className="ijet-best-summary-header">
            <span>Aspect</span>
            <span>Best range</span>
            <span>Best endurance</span>
          </div>
          <IJetBestSummaryRow
            aspect="Mix"
            endurance={formatMixPoint(bestEndurancePoint)}
            range={formatMixPoint(bestRangePoint)}
          />
          <IJetBestSummaryRow
            aspect="Result"
            endurance={`${Math.round(bestEndurancePoint.enduranceMin)} min`}
            range={`${Math.round(bestRangePoint.rangeNm)} nm`}
          />
          <IJetBestSummaryRow
            aspect="Speed"
            endurance={`${Math.round(bestEndurancePoint.speedKt)} kt`}
            range={`${Math.round(bestRangePoint.speedKt)} kt`}
          />
          <IJetBestSummaryRow
            aspect="Gain"
            endurance={formatGain(bestEndurancePoint.enduranceGainPct)}
            range={formatGain(bestRangePoint.rangeGainPct)}
          />
          <IJetBestSummaryRow
            aspect="Baseline split"
            endurance={`${endurance.propCommandPct.toFixed(0)}% prop / ${endurance.commandPct.toFixed(0)}% jet`}
            range={`${splitRatio.toFixed(2)} jet / prop`}
          />
          <IJetBestSummaryRow
            aspect="Caps"
            endurance={`${propCapPct.toFixed(0)}% prop cap / ${jetAtPropCapPct.toFixed(0)}% jet at cap`}
            range={`${packCurrentLimitA.toFixed(0)} A battery / ${(selectedMotor.maxCurrentA * comparison.engineCount).toFixed(0)} A motor`}
          />
          <IJetBestSummaryRow
            aspect="Mode"
            endurance={propCapPct < 99.5 ? "battery limited" : "not active"}
            range={`${formatGain(averageEnduranceGain)} avg endurance`}
          />
        </div>
      </section>

      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Command Logic</h2>
        </div>
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Normal Split">
            <JetMetric label="Prop command" value={`${endurance.propCommandPct.toFixed(0)}%`} />
            <JetMetric label="Jet command" value={`${endurance.commandPct.toFixed(0)}%`} />
            <JetMetric label="Split ratio" value={`${splitRatio.toFixed(2)}`} />
            <JetMetric label="Mode" value="baseline only" />
          </ResultGroup>
          <ResultGroup title="Optimized Strategy">
            <JetMetric label="Constraint" value="match baseline thrust" />
            <JetMetric label="Search" value="prop and jet split" />
            <JetMetric label="Goal" value="endurance + range" />
            <JetMetric label="Mode" value="row optimizer" />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel jet-comparison-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Command Curve</h2>
        </div>
        <div className="jet-condition-table ijet-mixer-table">
          <div className="jet-condition-row header ijet-mixer-row">
            <span>Master</span>
            <span>Prop command</span>
            <span>Jet command</span>
            <span>Base split</span>
            <span>Speed</span>
            <span>Endurance</span>
            <span>Gain</span>
            <span>Range</span>
            <span>Mode</span>
          </div>
          {commandCurve.map((point) => (
            <IJetMixerRow key={point.masterCommandPct} point={point} />
          ))}
        </div>
        <IJetMixerCurve points={commandCurve} />
        <IJetCommandCurve points={commandCurve} />
      </section>
    </main>
  );
}

function IJetBestSummaryRow({ aspect, endurance, range }: { aspect: string; endurance: string; range: string }) {
  return (
    <div className="ijet-best-summary-row">
      <span>{aspect}</span>
      <strong>{range}</strong>
      <strong>{endurance}</strong>
    </div>
  );
}

function formatGain(gainPct: number | null) {
  if (gainPct === null || !Number.isFinite(gainPct)) return "-";
  return `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%`;
}

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

function formatMixPoint(point: IJetCommandMixPoint | undefined) {
  if (!point) return "-";
  return `${roundToFive(point.masterCommandPct)}% master, ${roundToFive(point.propCommandPct)}% prop / ${roundToFive(point.jetCommandPct)}% jet`;
}

function formatEnduranceGain(point: IJetCommandMixPoint) {
  if (point.baselineEnduranceMin <= 0 && point.enduranceMin > 0) return "new flyable";
  return formatGain(point.enduranceGainPct);
}

function IJetMixerRow({ point }: { point: IJetCommandMixPoint }) {
  return (
    <div className={`jet-condition-row jet-condition-data ijet-mixer-row ${point.mode === "prop-capped" ? "prop-capped-row" : ""}`}>
      <strong>{point.masterCommandPct.toFixed(0)}%</strong>
      <span>{point.propCommandPct.toFixed(0)}%</span>
      <span>{point.jetCommandPct.toFixed(0)}%</span>
      <span>{point.baselinePropCommandPct.toFixed(0)} / {point.baselineJetCommandPct.toFixed(0)}%</span>
      <span>{point.speedKt.toFixed(1)} kt</span>
      <span>{point.enduranceMin.toFixed(1)} min</span>
      <span>{formatEnduranceGain(point)}</span>
      <span>{point.rangeNm.toFixed(1)} nm</span>
      <span>{point.mode === "prop-capped" ? "prop capped" : point.mode}</span>
    </div>
  );
}

function IJetMixerCurve({ points }: { points: IJetCommandMixPoint[] }) {
  const width = 760;
  const height = 260;
  const padding = 42;
  const maxSpeed = Math.max(1, ...points.map((point) => point.speedKt)) * 1.08;
  const maxEndurance = Math.max(1, ...points.map((point) => point.enduranceMin)) * 1.08;
  const maxRange = Math.max(1, ...points.map((point) => point.rangeNm)) * 1.08;
  const plotHeight = height - padding * 2;
  const xFor = (masterCommandPct: number) => padding + (masterCommandPct / 100) * (width - padding * 2);
  const yFor = (value: number, max: number) => height - padding - (value / max) * plotHeight;
  const pathFor = (valueFor: (point: IJetCommandMixPoint) => number, max: number) =>
    points.map((point, index) => `${index ? "L" : "M"} ${xFor(point.masterCommandPct).toFixed(1)} ${yFor(valueFor(point), max).toFixed(1)}`).join(" ");
  const ticks = [0, 50, 100];
  return (
    <div className="jet-curve-wrap">
      <svg className="jet-curve ijet-mixer-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="iJet endurance range speed curve">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />
        <line x1={padding} x2={padding} y1={padding} y2={height - padding} />
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid" x1={padding} x2={width - padding} y1={yFor(tick, 100)} y2={yFor(tick, 100)} />
            <text x={padding - 10} y={yFor(tick, 100) + 4}>{tick}%</text>
          </g>
        ))}
        {[0, 20, 40, 60, 80, 100].map((pct) => (
          <text key={pct} x={xFor(pct)} y={height - 10}>{pct}%</text>
        ))}
        <text x={padding} y={22}>normalized vs master command</text>
        <path className="endurance" d={pathFor((point) => point.enduranceMin, maxEndurance)} />
        <path className="range" d={pathFor((point) => point.rangeNm, maxRange)} />
        <path className="speed" d={pathFor((point) => point.speedKt, maxSpeed)} />
        {points.map((point) => (
          <g key={point.masterCommandPct}>
            <circle className="endurance" cx={xFor(point.masterCommandPct)} cy={yFor(point.enduranceMin, maxEndurance)} r={3} />
            <circle className="range" cx={xFor(point.masterCommandPct)} cy={yFor(point.rangeNm, maxRange)} r={3} />
            <circle className="speed" cx={xFor(point.masterCommandPct)} cy={yFor(point.speedKt, maxSpeed)} r={3} />
          </g>
        ))}
      </svg>
      <div className="jet-curve-legend">
        <span><i className="endurance" /> endurance, max {maxEndurance.toFixed(1)} min</span>
        <span><i className="range" /> range, max {maxRange.toFixed(1)} nm</span>
        <span><i className="speed" /> speed, max {maxSpeed.toFixed(1)} kt</span>
      </div>
    </div>
  );
}

function IJetCommandCurve({ points }: { points: IJetCommandMixPoint[] }) {
  const width = 760;
  const height = 220;
  const padding = 42;
  const plotHeight = height - padding * 2;
  const xFor = (masterCommandPct: number) => padding + (masterCommandPct / 100) * (width - padding * 2);
  const yFor = (commandPct: number) => height - padding - (commandPct / 100) * plotHeight;
  const pathFor = (valueFor: (point: IJetCommandMixPoint) => number) =>
    points.map((point, index) => `${index ? "L" : "M"} ${xFor(point.masterCommandPct).toFixed(1)} ${yFor(valueFor(point)).toFixed(1)}`).join(" ");
  const ticks = [0, 50, 100];
  return (
    <div className="jet-curve-wrap">
      <svg className="jet-curve ijet-command-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="iJet command split curve">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />
        <line x1={padding} x2={padding} y1={padding} y2={height - padding} />
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid" x1={padding} x2={width - padding} y1={yFor(tick)} y2={yFor(tick)} />
            <text x={padding - 10} y={yFor(tick) + 4}>{tick}%</text>
          </g>
        ))}
        {[0, 20, 40, 60, 80, 100].map((pct) => (
          <text key={pct} x={xFor(pct)} y={height - 10}>{pct}%</text>
        ))}
        <text x={padding} y={22}>command split vs master</text>
        <path className="prop" d={pathFor((point) => point.propCommandPct)} />
        <path className="jet" d={pathFor((point) => point.jetCommandPct)} />
        {points.map((point) => (
          <g key={point.masterCommandPct}>
            <circle className="prop" cx={xFor(point.masterCommandPct)} cy={yFor(point.propCommandPct)} r={3} />
            <circle className="jet" cx={xFor(point.masterCommandPct)} cy={yFor(point.jetCommandPct)} r={3} />
          </g>
        ))}
      </svg>
      <div className="jet-curve-legend">
        <span><i className="prop" /> prop command</span>
        <span><i className="jet" /> jet command</span>
      </div>
    </div>
  );
}
