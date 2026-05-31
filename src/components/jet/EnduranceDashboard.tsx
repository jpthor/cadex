import { Gauge, Timer } from "lucide-react";
import type { ComponentProps } from "react";
import type { PropulsionTabState } from "../../app/types";
import { computeJetComparison } from "../../jetEngine";
import type { EnduranceAssistPoint } from "../../jetEngine";
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

export function EnduranceDashboard({
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
  const best = comparison.enduranceAssistBest;
  const enduranceGainMin = best.enduranceMin - comparison.baseCruise.enduranceMin;
  const enduranceGainPct = comparison.baseCruise.enduranceMin > 0 ? (best.enduranceMin / comparison.baseCruise.enduranceMin - 1) * 100 : 0;
  const rangeGainNm = best.rangeNm - comparison.baseCruise.rangeNm;

  return (
    <main className="propulsion-workspace jet-workspace endurance-workspace">
      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Timer size={20} />
          <h2>Endurance</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Holds the base aircraft best-cruise speed, then burns fuel over the flight, recomputes mass and drag, and lets jet thrust replace prop thrust so battery power falls instead of speed rising.
        </p>
        <div className="jet-metric-grid jet-base-grid">
          <JetMetricTile label="Best endurance mix" value={formatEnduranceMix(best)} />
          <JetMetricTile label="Best endurance" value={best.flyable ? `${Math.round(best.enduranceMin)} min` : "not flyable"} />
          <JetMetricTile label="Best range" value={best.flyable ? `${Math.round(best.rangeNm)} nm` : "not flyable"} />
          <JetMetricTile label="Best speed" value={best.flyable ? `${Math.round(best.speedKt)} kt` : "not flyable"} />
          <JetMetricTile label="Limiter" value={limiterLabel(best.enduranceLimiter)} />
          <JetMetricTile label="Target speed" value={best.flyable ? `${best.speedKt.toFixed(1)} kt` : "not flyable"} />
          <JetMetricTile label="Base endurance" value={comparison.baseCruise.flyable ? `${comparison.baseCruise.enduranceMin.toFixed(1)} min` : "not flyable"} />
          <JetMetricTile label="Detailed endurance" value={best.flyable ? `${best.enduranceMin.toFixed(1)} min` : "not flyable"} />
          <JetMetricTile label="Endurance gain" value={best.flyable ? `${formatSigned(enduranceGainMin, "min")} / ${formatSigned(enduranceGainPct, "%")}` : "-"} />
          <JetMetricTile label="Base range" value={comparison.baseCruise.flyable ? `${comparison.baseCruise.rangeNm.toFixed(1)} nm` : "not flyable"} />
          <JetMetricTile label="Endurance range" value={best.flyable ? `${best.rangeNm.toFixed(1)} nm` : "not flyable"} />
          <JetMetricTile label="Range gain" value={best.flyable ? formatSigned(rangeGainNm, "nm") : "-"} />
        </div>
      </section>

      <section className="propulsion-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Best Endurance Point</h2>
        </div>
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Commands">
            <JetMetric label="Jet command" value={`${best.commandPct.toFixed(0)}%`} />
            <JetMetric label="Prop command" value={`${best.propCommandPct.toFixed(0)}%`} />
            <JetMetric label="Speed" value={`${best.speedKt.toFixed(1)} kt`} />
            <JetMetric label="Jet thrust" value={`${best.jetThrustN.toFixed(0)} N`} />
          </ResultGroup>
          <ResultGroup title="Energy">
            <JetMetric label="Battery draw" value={formatPower(best.batteryPowerW)} />
            <JetMetric label="Fuel burn" value={`${best.fuelBurnKgMin.toFixed(2)} kg/min`} />
            <JetMetric label="Battery time" value={formatMinutes(best.batteryEnduranceMin)} />
            <JetMetric label="Fuel time" value={formatMinutes(best.fuelEnduranceMin)} />
          </ResultGroup>
          <ResultGroup title="Prop Relief">
            <JetMetric label="Base cruise power" value={formatPower(comparison.baseCruise.powerW)} />
            <JetMetric label="Assisted prop power" value={formatPower(best.propPowerW)} />
            <JetMetric label="Prop thrust" value={`${best.propThrustN.toFixed(0)} N`} />
            <JetMetric label="Fuel at full command" value={`${comparison.fuelMinutesAtFullCommand.toFixed(1)} min`} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel jet-comparison-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Endurance Sweep</h2>
        </div>
        <div className="jet-condition-table endurance-condition-table">
          <div className="jet-condition-row header endurance-condition-row">
            <span>Jet command</span>
            <span>Prop command</span>
            <span>Speed</span>
            <span>Prop power</span>
            <span>Fuel burn</span>
            <span>Battery time</span>
            <span>Fuel time</span>
            <span>Endurance</span>
            <span>Range</span>
          </div>
          {comparison.enduranceAssistSweep.map((point) => (
            <EnduranceRow key={point.commandPct} point={point} />
          ))}
        </div>
        <EnduranceCommandCurve points={comparison.enduranceAssistSweep} best={best} />
      </section>
    </main>
  );
}

function EnduranceRow({ point }: { point: EnduranceAssistPoint }) {
  return (
    <div className={`jet-condition-row jet-condition-data endurance-condition-row ${point.flyable ? "" : "not-flyable-row"}`}>
      <strong>{point.commandPct.toFixed(0)}%</strong>
      <span>{point.propCommandPct.toFixed(0)}%</span>
      <span>{point.flyable ? `${point.speedKt.toFixed(1)} kt` : "-"}</span>
      <span>{formatPower(point.propPowerW)}</span>
      <span>{point.fuelBurnKgMin.toFixed(2)} kg/min</span>
      <span>{point.flyable ? formatMinutes(point.batteryEnduranceMin) : "-"}</span>
      <span>{formatMinutes(point.fuelEnduranceMin)}</span>
      <span>{point.flyable ? `${point.enduranceMin.toFixed(1)} min ${limiterSuffix(point.enduranceLimiter)}` : "not flyable"}</span>
      <span>{point.flyable ? `${point.rangeNm.toFixed(1)} nm` : "-"}</span>
    </div>
  );
}

function EnduranceCommandCurve({ best, points }: { best: EnduranceAssistPoint; points: EnduranceAssistPoint[] }) {
  const width = 760;
  const height = 260;
  const padding = 44;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const maxEndurance = Math.max(1, ...points.map((point) => point.enduranceMin)) * 1.08;
  const xFor = (commandPct: number) => padding + (commandPct / 100) * plotWidth;
  const yFor = (enduranceMin: number) => height - padding - (enduranceMin / maxEndurance) * plotHeight;
  const path = points.map((point, index) => `${index ? "L" : "M"} ${xFor(point.commandPct).toFixed(1)} ${yFor(point.enduranceMin).toFixed(1)}`).join(" ");
  const yTicks = [0, maxEndurance / 2, maxEndurance];
  return (
    <div className="jet-curve-wrap">
      <svg className="jet-curve endurance-command-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Best endurance by jet command">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />
        <line x1={padding} x2={padding} y1={padding} y2={height - padding} />
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick.toFixed(1)}>
              <line className="grid" x1={padding} x2={width - padding} y1={y} y2={y} />
              <text className="axis-label" x={padding - 8} y={y + 4} textAnchor="end">{tick.toFixed(0)}</text>
            </g>
          );
        })}
        {[0, 20, 40, 60, 80, 100].map((pct) => (
          <text key={pct} x={xFor(pct)} y={height - 10}>{pct}%</text>
        ))}
        <text x={padding} y={22}>endurance (min)</text>
        <path className="endurance" d={path} />
        {points.map((point) => (
          <g key={point.commandPct}>
            <circle className={point.enduranceLimiter === "fuel" ? "fuel" : "battery"} cx={xFor(point.commandPct)} cy={yFor(point.enduranceMin)} r={3.5} />
            {Math.abs(point.commandPct - best.commandPct) < 0.001 ? (
              <circle className="best" cx={xFor(point.commandPct)} cy={yFor(point.enduranceMin)} r={8} />
            ) : null}
          </g>
        ))}
      </svg>
      <div className="jet-curve-legend">
        <span><i className="endurance" /> endurance by jet command</span>
        <span><i className="battery" /> battery-limited point</span>
        <span><i className="fuel" /> fuel-limited point</span>
        <span>ring marks best endurance</span>
      </div>
    </div>
  );
}

function formatMinutes(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)} min` : "-";
}

function formatPower(valueW: number) {
  if (!Number.isFinite(valueW)) return "-";
  return valueW >= 1000 ? `${(valueW / 1000).toFixed(1)} kW` : `${valueW.toFixed(0)} W`;
}

function formatSigned(value: number, unit: string) {
  const suffix = unit === "%" ? "%" : ` ${unit}`;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

function formatEnduranceMix(point: EnduranceAssistPoint) {
  if (!point.flyable) return "-";
  return `${roundToFive(point.commandPct)}% jet / ${roundToFive(point.propCommandPct)}% prop`;
}

function limiterLabel(limiter: EnduranceAssistPoint["enduranceLimiter"]) {
  if (limiter === "battery") return "battery";
  if (limiter === "fuel") return "fuel";
  return "none";
}

function limiterSuffix(limiter: EnduranceAssistPoint["enduranceLimiter"]) {
  if (limiter === "battery") return "battery";
  if (limiter === "fuel") return "fuel";
  return "";
}
