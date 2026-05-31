import { Fan, Gauge, Fuel, PlaneTakeoff } from "lucide-react";
import type { ComponentProps } from "react";
import type { PropulsionTabState } from "../../app/types";
import { computeJetComparison } from "../../jetEngine";
import type { JetComparison, JetCondition } from "../../jetEngine";
import { turbineEngineOptions } from "../../sketch/constants";
import type { SizingProject } from "../../sizing";
import { Metric, MetricTile, ResultGroup } from "../ui/Metric";
import { PropulsionNumberField } from "../propulsion/fields";
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

function JetFieldLabel({ label }: { label: string }) {
  const info = jetInfoFor(label);
  return (
    <span className={`field-label ${info ? "has-info" : ""}`}>
      {label}
      {info ? <span className="field-tooltip">{info}</span> : null}
    </span>
  );
}

export function JetDashboard({
  aircraftMassKg,
  batteryEnergyDensityWhKg,
  onSizingProjectChange,
  propulsionState,
  sizingProject,
}: {
  aircraftMassKg: number;
  batteryEnergyDensityWhKg: number;
  onSizingProjectChange: (next: SizingProject) => void;
  propulsionState: PropulsionTabState;
  sizingProject: SizingProject;
}) {
  const comparison = computeJetComparison({
    aircraftMassKg,
    batteryEnergyDensityWhKg,
    propulsionState,
    sizingProject,
  });
  const jetPackageMassKg = comparison.engineMassKg + comparison.fuelMassKg;
  const hybridImpossible = comparison.feasibility.hybridThrustDeficitN > 0;
  const baseCruiseGains = comparison.selectedCommand.gainsVsBaseCruise;
  const takeoffTwBoost = comparison.takeoffState.hybridThrustToWeight - comparison.takeoffState.propOnlyThrustToWeight;
  const takeoffTwBoostPct = comparison.takeoffState.propOnlyThrustToWeight > 0
    ? (takeoffTwBoost / comparison.takeoffState.propOnlyThrustToWeight) * 100
    : 0;
  const hybridTakeoffThrustN = comparison.takeoffState.hybridThrustToWeight * comparison.takeoffState.massKg * 9.80665;
  function updateMission(patch: Partial<SizingProject["mission"]>) {
    onSizingProjectChange({ ...sizingProject, mission: { ...sizingProject.mission, ...patch }, analysis: undefined });
  }
  return (
    <main className="propulsion-workspace jet-workspace">
      <section className="propulsion-panel jet-base-panel">
        <div className="propulsion-title">
          <Fan size={20} />
          <h2>Base Aircraft</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Prop-only aircraft before adding the turbine package.
        </p>
        <div className="jet-metric-grid jet-base-grid">
          <JetMetricTile label="Total mass" value={`${comparison.propOnlyMassKg.toFixed(2)} kg`} />
          <JetMetricTile label="Battery mass" value={`${comparison.batteryMassKg.toFixed(2)} kg`} />
          <JetMetricTile label="Takeoff T/W" value={comparison.takeoffState.propOnlyThrustToWeight.toFixed(2)} />
          <JetMetricTile label="Best cruise speed" value={comparison.baseCruise.flyable ? `${comparison.baseCruise.speedKt.toFixed(1)} kt` : `below ${comparison.baseCruise.minimumFlyableSpeedKt.toFixed(1)} kt`} />
          <JetMetricTile label="Best cruise power" value={comparison.baseCruise.flyable ? formatPower(comparison.baseCruise.powerW) : "not flyable"} />
          <JetMetricTile label="Best cruise prop" value={comparison.baseCruise.flyable ? `${comparison.baseCruise.powerPct.toFixed(0)}% power / ${comparison.baseCruise.commandPct.toFixed(0)}% cmd` : "not flyable"} />
          <JetMetricTile label="Best cruise endurance" value={comparison.baseCruise.flyable ? `${comparison.baseCruise.enduranceMin.toFixed(1)} min` : "not flyable"} />
          <JetMetricTile label="Power source" value={`${comparison.batteryName}`} />
          <JetMetricTile label="Best cruise range" value={comparison.baseCruise.flyable ? `${comparison.baseCruise.rangeNm.toFixed(1)} nm` : "not flyable"} />
        </div>
      </section>

      <section className="propulsion-panel jet-setup-panel">
        <div className="propulsion-title">
          <Fuel size={20} />
          <h2>Jet Group</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Kerosene turbines from Sizing. Jet command follows motor command: 100% motor means 100% jet, 50% motor means 50% jet, idle means idle.
          Command thrust drives motors and jets together; motor-only rows are reference rows to show what the jets add.
        </p>
        <div className="jet-metric-grid jet-setup-grid">
          <label className="propulsion-field propulsion-field-wide">
            <JetFieldLabel label="Engine" />
            <div>
              <select value={sizingProject.mission.turbineEngineId} onChange={(event) => updateMission({ turbineEngineId: event.target.value })}>
                {turbineEngineOptions.map((engine) => (
                  <option key={engine.id} value={engine.id}>
                    {engine.maker} {engine.model} - {engine.thrustN} N
                  </option>
                ))}
              </select>
            </div>
            <small>{comparison.engine.source}</small>
          </label>
          <PropulsionNumberField
            info={jetInfoFor("Fuel at full command")}
            label="Fuel at full command"
            suffix="min"
            step={1}
            value={comparison.fuelMinutesAtFullCommand}
            onChange={(turbineFuelMin) => updateMission({ turbineFuelMin: Math.max(0, turbineFuelMin) })}
          />
          <JetMetricTile label="Engines" value={`${comparison.engineCount}`} />
          <JetMetricTile label="Total jet thrust" value={`${(comparison.engine.thrustN * comparison.engineCount).toFixed(0)} N`} />
          <JetMetricTile label="Engine mass" value={`${comparison.engineMassKg.toFixed(2)} kg`} />
          <JetMetricTile label="Fuel mass" value={`${comparison.fuelMassKg.toFixed(2)} kg`} />
          <JetMetricTile label="Engine + fuel" value={`${jetPackageMassKg.toFixed(2)} kg`} />
        </div>
      </section>

      <section className="propulsion-panel jet-command-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Hybrid Aircraft</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Aircraft with the jet group added.
        </p>
        {hybridImpossible ? (
          <div className="jet-feasibility-error">
            <strong>Impossible at 100% thrust</strong>
            <span>
              Target is {comparison.feasibility.targetThrustToWeight.toFixed(2)} T/W, but prop + jet reaches {comparison.feasibility.hybridTakeoffThrustToWeight.toFixed(2)} T/W.
              Short by {(comparison.feasibility.targetThrustToWeight - comparison.feasibility.hybridTakeoffThrustToWeight).toFixed(2)} T/W.
            </span>
          </div>
        ) : null}
        <div className="jet-hybrid-rows">
          <div className="jet-hybrid-row">
            <h3>Takeoff</h3>
            <div className="jet-metric-grid jet-hybrid-grid">
              <JetMetricTile label="Command" value="100%" />
              <JetMetricTile label="Total mass" value={`${comparison.aircraftMassKg.toFixed(2)} kg`} />
              <JetMetricTile label="Added jet mass" value={`+${jetPackageMassKg.toFixed(2)} kg`} />
              <JetMetricTile label="Base T/W" value={comparison.takeoffState.propOnlyThrustToWeight.toFixed(2)} />
              <JetMetricTile label="Total thrust" value={`${hybridTakeoffThrustN.toFixed(0)} N`} />
              <JetMetricTile label="Takeoff T/W" value={comparison.takeoffState.hybridThrustToWeight.toFixed(2)} />
              <JetMetricTile label="T/W boost" value={formatSignedPair(takeoffTwBoost, takeoffTwBoostPct)} />
              <JetMetricTile label="Target T/W" value={comparison.feasibility.targetThrustToWeight.toFixed(2)} />
            </div>
          </div>
          <div className="jet-hybrid-row">
            <h3>Cruise</h3>
            <div className="jet-metric-grid jet-hybrid-grid">
              <JetMetricTile label="Cruise command" value={`${comparison.selectedCommand.condition.commandPct.toFixed(0)}%`} />
              <JetMetricTile label="Speed" value={`${comparison.selectedCommand.condition.speedKt.toFixed(1)} kt`} />
              <JetMetricTile label="Power draw" value={`${formatPower(comparison.selectedCommand.condition.batteryPowerW)} / ${comparison.selectedCommand.condition.batteryCurrentA.toFixed(0)} A`} />
              <JetMetricTile label="Fuel burn" value={`${comparison.selectedCommand.condition.fuelBurnKgMin.toFixed(2)} kg/min`} />
              <JetMetricTile label="Endurance" value={`${comparison.selectedCommand.condition.enduranceMin.toFixed(1)} min`} />
              <JetMetricTile label="Limiter" value={limiterLabel(comparison.selectedCommand.condition.enduranceLimiter)} />
              <JetMetricTile label="Range" value={`${comparison.selectedCommand.condition.rangeNm.toFixed(1)} nm`} />
              <JetMetricTile label="Vs best-cruise speed" value={formatGain(baseCruiseGains.speedKt, "kt")} />
              <JetMetricTile label="Vs best-cruise range" value={formatGain(baseCruiseGains.rangeNm, "nm")} />
            </div>
          </div>
        </div>
      </section>

      <section className="propulsion-panel jet-comparison-panel">
        <div className="propulsion-title">
          <PlaneTakeoff size={20} />
          <h2>Command Sweep</h2>
        </div>
        <div className="jet-condition-table">
          <JetConditionHeader />
          {comparison.commandThrust.map((point) => (
            <JetConditionGroup
              hybrid={point.hybrid}
              key={point.commandPct}
              motor={point.motor}
              commandPct={point.commandPct}
            />
          ))}
        </div>
      </section>

      <section className="propulsion-panel jet-range-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Hybrid Best Range</h2>
        </div>
        <p className="propulsion-demand-explainer">
          This sweeps motor+jet command together and shows where range peaks before the battery/fuel limiter changes.
        </p>
        <div className="propulsion-result-groups compact">
          <ResultGroup title="Best Point">
            <JetMetric label="Command" value={`${comparison.bestRangeCommand.commandPct.toFixed(0)}%`} />
            <JetMetric label="Range" value={`${comparison.bestRangeCommand.rangeNm.toFixed(1)} nm`} />
            <JetMetric label="Speed" value={`${comparison.bestRangeCommand.speedKt.toFixed(1)} kt`} />
            <JetMetric label="Endurance" value={`${comparison.bestRangeCommand.enduranceMin.toFixed(1)} min`} />
          </ResultGroup>
          <ResultGroup title="Limiter">
            <JetMetric label="Limiter" value={limiterLabel(comparison.bestRangeCommand.enduranceLimiter)} />
            <JetMetric label="Battery time" value={formatMinutes(comparison.bestRangeCommand.batteryEnduranceMin)} />
            <JetMetric label="Fuel time" value={formatMinutes(comparison.bestRangeCommand.fuelEnduranceMin)} />
            <JetMetric label="Fuel burn" value={`${comparison.bestRangeCommand.fuelBurnKgMin.toFixed(2)} kg/min`} />
          </ResultGroup>
        </div>
        <HybridRangeCurve comparison={comparison} />
      </section>

      <section className="propulsion-panel jet-takeoff-panel">
        <div className="propulsion-title">
          <PlaneTakeoff size={20} />
          <h2>Takeoff At 100%</h2>
        </div>
        <div className="jet-side-by-side">
          <ResultGroup title="Prop-only">
            <JetMetric label="Battery" value={`${comparison.takeoffState.batterySocPct.toFixed(0)}%`} />
            <JetMetric label="Fuel" value="-" />
            <JetMetric label="Mass" value={`${comparison.takeoffState.propOnlyMassKg.toFixed(2)} kg`} />
            <JetMetric label="Prop-only T/W" note={marginLabel(comparison.takeoffState.propOnlyExcessMarginPct)} noteTone={marginTone(comparison.takeoffState.propOnlyExcessMarginPct)} value={comparison.takeoffState.propOnlyThrustToWeight.toFixed(2)} />
            <JetMetric label="Prop-only required" value={`${comparison.takeoff.propOnlyRequiredThrustN.toFixed(0)} N`} />
            <JetMetric label="Prop-only command" value={`${comparison.takeoff.withoutJet.commandPct.toFixed(0)}%`} />
            <JetMetric label="Prop-only battery" value={`${comparison.takeoff.withoutJet.batteryCurrentA.toFixed(1)} A`} />
          </ResultGroup>
          <ResultGroup title="Hybrid">
            <JetMetric label="Battery" value={`${comparison.takeoffState.batterySocPct.toFixed(0)}%`} />
            <JetMetric label="Fuel" value={`${comparison.takeoffState.fuelPct.toFixed(0)}%`} />
            <JetMetric label="Mass" value={`${comparison.takeoffState.massKg.toFixed(2)} kg`} />
            <JetMetric label="Hybrid T/W" note={marginLabel(comparison.takeoffState.hybridExcessMarginPct)} noteTone={marginTone(comparison.takeoffState.hybridExcessMarginPct)} value={comparison.takeoffState.hybridThrustToWeight.toFixed(2)} />
            <JetMetric label="Hybrid required" value={`${comparison.takeoff.requiredThrustN.toFixed(0)} N`} />
            <JetMetric label="Hybrid command" value={`${comparison.takeoff.withJet.commandPct.toFixed(0)}%`} />
            <JetMetric label="Hybrid battery" value={`${comparison.takeoff.withJet.batteryCurrentA.toFixed(1)} A`} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel jet-landing-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>Landing At 10% Reserve</h2>
        </div>
        <div className="jet-side-by-side">
          <ResultGroup title="Prop-only">
            <JetMetric label="Battery" value={`${comparison.landing.batterySocPct.toFixed(0)}%`} />
            <JetMetric label="Fuel remaining" value="-" />
            <JetMetric label="Mass" value={`${comparison.landing.propOnlyMassKg.toFixed(2)} kg`} />
            <JetMetric label="Prop-only T/W" note={marginLabel(comparison.landing.propOnlyExcessMarginPct)} noteTone={marginTone(comparison.landing.propOnlyExcessMarginPct)} value={comparison.landing.propOnlyThrustToWeight.toFixed(2)} />
            <JetMetric label="Prop-only excess" value={`${comparison.landing.propOnlyExcessMarginPct.toFixed(0)}%`} />
          </ResultGroup>
          <ResultGroup title="Hybrid">
            <JetMetric label="Battery" value={`${comparison.landing.batterySocPct.toFixed(0)}%`} />
            <JetMetric label="Fuel remaining" value={`${comparison.landing.fuelPct.toFixed(0)}%`} />
            <JetMetric label="Mass" value={`${comparison.landing.massKg.toFixed(2)} kg`} />
            <JetMetric label="Dry mass" value={`${comparison.dryMassKg.toFixed(2)} kg`} />
            <JetMetric label="Hybrid T/W" note={marginLabel(comparison.landing.hybridExcessMarginPct)} noteTone={marginTone(comparison.landing.hybridExcessMarginPct)} value={comparison.landing.hybridThrustToWeight.toFixed(2)} />
            <JetMetric label="Hybrid excess" value={`${comparison.landing.hybridExcessMarginPct.toFixed(0)}%`} />
          </ResultGroup>
        </div>
      </section>

      <section className="propulsion-panel jet-curve-panel">
        <div className="propulsion-title">
          <Gauge size={20} />
          <h2>T/W And Turbine Fuel Curve</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Battery and fuel move together from 100% to 10%. Battery voltage falls as fuel mass burns off.
        </p>
        <ThrustCurve comparison={comparison} />
        <TurbineFuelCurve comparison={comparison} />
      </section>
    </main>
  );
}

function JetConditionHeader() {
  return (
    <div className="jet-condition-row header">
      <span>Condition</span>
      <span>Case</span>
      <span>Speed</span>
      <span>Battery draw</span>
      <span>Fuel burn</span>
      <span>Battery time</span>
      <span>Fuel time</span>
      <span>Endurance</span>
      <span>Range</span>
    </div>
  );
}

function JetConditionGroup({
  commandPct,
  hybrid,
  motor,
}: {
  commandPct: number;
  hybrid: JetCondition;
  motor: JetCondition;
}) {
  return (
    <div className="jet-condition-group">
      <div className="jet-condition-command">
        <strong>{commandPct.toFixed(0)}% command</strong>
        <small>
          {motor.totalThrustN.toFixed(0)} N prop
          <br />
          {hybrid.totalThrustN.toFixed(0)} N hybrid
        </small>
      </div>
      <div className="jet-condition-pair">
        <JetConditionRow condition={motor} hasJet={false} variant="Motor ref" />
        <JetConditionRow condition={hybrid} hasJet variant="Motor + jet" />
      </div>
    </div>
  );
}

function JetConditionRow({
  condition,
  hasJet,
  variant,
}: {
  condition: JetCondition;
  hasJet: boolean;
  variant: string;
}) {
  return (
    <div className={`jet-condition-row jet-condition-data ${hasJet ? "jet-assisted-row" : ""} ${condition.flyable ? "" : "not-flyable-row"}`}>
      <strong className="jet-case-label">
        {hasJet ? <Fuel size={14} /> : <Fan size={14} />}
        {variant}
      </strong>
      <span>{condition.flyable && condition.speedKt > 0 ? `${condition.speedKt.toFixed(1)} kt` : `below ${condition.minimumFlyableSpeedKt.toFixed(1)} kt`}</span>
      <span>{formatPower(condition.batteryPowerW)}</span>
      <span>{hasJet && condition.fuelBurnKgMin > 0 ? `${condition.fuelBurnKgMin.toFixed(2)} kg/min` : "-"}</span>
      <span>{condition.flyable ? formatMinutes(condition.batteryEnduranceMin) : "-"}</span>
      <span>{hasJet ? formatMinutes(condition.fuelEnduranceMin) : "-"}</span>
      <span>{condition.flyable && condition.enduranceMin > 0 ? `${condition.enduranceMin.toFixed(1)} min ${limiterSuffix(condition.enduranceLimiter)}` : "not flyable"}</span>
      <span>{condition.flyable && condition.rangeNm > 0 ? `${condition.rangeNm.toFixed(1)} nm` : "-"}</span>
    </div>
  );
}

function ThrustCurve({ comparison }: { comparison: JetComparison }) {
  const width = 760;
  const height = 240;
  const padding = 42;
  const maxTW = Math.max(1, ...comparison.thrustCurve.flatMap((point) => [point.propOnlyTW, point.hybridTW])) * 1.08;
  const yTicks = Array.from({ length: 5 }, (_, index) => (maxTW * index) / 4);
  const xFor = (index: number) => padding + (index / Math.max(comparison.thrustCurve.length - 1, 1)) * (width - padding * 2);
  const yFor = (tw: number) => height - padding - (tw / maxTW) * (height - padding * 2);
  const propPath = comparison.thrustCurve.map((point, index) => `${index ? "L" : "M"} ${xFor(index).toFixed(1)} ${yFor(point.propOnlyTW).toFixed(1)}`).join(" ");
  const hybridPath = comparison.thrustCurve.map((point, index) => `${index ? "L" : "M"} ${xFor(index).toFixed(1)} ${yFor(point.hybridTW).toFixed(1)}`).join(" ");
  return (
    <div className="jet-curve-wrap">
      <svg className="jet-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Thrust to weight curve">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />
        <line x1={padding} x2={padding} y1={padding} y2={height - padding} />
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick.toFixed(2)}>
              <line className="grid" x1={padding} x2={width - padding} y1={y} y2={y} />
              <text className="axis-label" x={padding - 8} y={y + 4} textAnchor="end">{tick.toFixed(1)}</text>
            </g>
          );
        })}
        {[10, 25, 50, 75, 100].map((pct) => {
          const x = padding + ((100 - pct) / 100) * (width - padding * 2);
          return <text key={pct} x={x} y={height - 8}>{pct}%</text>;
        })}
        <text x={padding} y={20}>T/W ratio</text>
        <path className="prop" d={propPath} />
        <path className="hybrid" d={hybridPath} />
        {comparison.thrustCurve.map((point, index) => (
          <g key={point.batteryPct}>
            <circle className="prop" cx={xFor(index)} cy={yFor(point.propOnlyTW)} r={3} />
            <circle className="hybrid" cx={xFor(index)} cy={yFor(point.hybridTW)} r={3} />
          </g>
        ))}
      </svg>
      <div className="jet-curve-legend">
        <span><i className="prop" /> prop only</span>
        <span><i className="hybrid" /> prop + jet</span>
        <span>left is full battery/fuel, right is 10% reserve</span>
      </div>
    </div>
  );
}

function TurbineFuelCurve({ comparison }: { comparison: JetComparison }) {
  const width = 760;
  const height = 220;
  const padding = 46;
  const rightPadding = 58;
  const maxFlow = 110;
  const maxPenalty = Math.max(2, ...comparison.turbineCurve.map((point) => point.fuelPerThrustFactor)) * 1.05;
  const xFor = (commandPct: number) => padding + (commandPct / 100) * (width - padding - rightPadding);
  const yFlow = (flowPct: number) => height - padding - (flowPct / maxFlow) * (height - padding * 2);
  const yPenalty = (factor: number) => height - padding - (factor / maxPenalty) * (height - padding * 2);
  const flowTicks = [0, 25, 50, 75, 100];
  const penaltyTicks = [0, maxPenalty / 2, maxPenalty];
  const flowPath = comparison.turbineCurve.map((point, index) => `${index ? "L" : "M"} ${xFor(point.commandPct).toFixed(1)} ${yFlow(point.fuelFlowPct).toFixed(1)}`).join(" ");
  const penaltyPath = comparison.turbineCurve.filter((point) => point.commandPct > 0).map((point, index) => `${index ? "L" : "M"} ${xFor(point.commandPct).toFixed(1)} ${yPenalty(point.fuelPerThrustFactor).toFixed(1)}`).join(" ");
  return (
    <div className="jet-curve-wrap">
      <svg className="jet-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Turbine fuel flow curve">
        <line x1={padding} x2={width - rightPadding} y1={height - padding} y2={height - padding} />
        <line x1={padding} x2={padding} y1={padding} y2={height - padding} />
        <line className="secondary-axis" x1={width - rightPadding} x2={width - rightPadding} y1={padding} y2={height - padding} />
        {flowTicks.map((tick) => {
          const y = yFlow(tick);
          return (
            <g key={tick}>
              <line className="grid" x1={padding} x2={width - rightPadding} y1={y} y2={y} />
              <text className="axis-label fuel-flow-label" x={padding - 8} y={y + 4} textAnchor="end">{tick}%</text>
            </g>
          );
        })}
        {penaltyTicks.map((tick) => {
          const y = yPenalty(tick);
          return <text className="axis-label fuel-penalty-label" key={tick.toFixed(2)} x={width - rightPadding + 8} y={y + 4}>{tick.toFixed(1)}x</text>;
        })}
        {[0, 30, 50, 80, 100].map((pct) => {
          const x = xFor(pct);
          return <text key={pct} x={x} y={height - 8}>{pct}%</text>;
        })}
        <text className="fuel-flow-label" x={padding} y={20}>fuel flow %</text>
        <text className="fuel-penalty-label" x={width - rightPadding} y={20} textAnchor="end">fuel / thrust</text>
        <path className="fuel-flow" d={flowPath} />
        <path className="fuel-penalty" d={penaltyPath} />
        {comparison.turbineCurve.map((point) => (
          <g key={point.commandPct}>
            <circle className="fuel-flow" cx={xFor(point.commandPct)} cy={yFlow(point.fuelFlowPct)} r={3} />
            {point.commandPct > 0 ? <circle className="fuel-penalty" cx={xFor(point.commandPct)} cy={yPenalty(point.fuelPerThrustFactor)} r={3} /> : null}
          </g>
        ))}
      </svg>
      <div className="jet-curve-legend">
        <span><i className="fuel-flow" /> fuel flow %</span>
        <span><i className="fuel-penalty" /> fuel per thrust penalty</span>
        <span>low command burns disproportionately more fuel per unit thrust</span>
      </div>
    </div>
  );
}

function HybridRangeCurve({ comparison }: { comparison: JetComparison }) {
  const width = 760;
  const height = 260;
  const padding = 38;
  const points = comparison.bestRangeSweep;
  const maxRange = Math.max(1, ...points.map((point) => point.rangeNm)) * 1.08;
  const maxTime = Math.max(1, ...points.flatMap((point) => [finiteOrZero(point.batteryEnduranceMin), finiteOrZero(point.fuelEnduranceMin)])) * 1.08;
  const xFor = (commandPct: number) => padding + ((commandPct - 10) / 90) * (width - padding * 2);
  const yRange = (rangeNm: number) => height - padding - (rangeNm / maxRange) * (height - padding * 2);
  const yTime = (minutes: number) => height - padding - (minutes / maxTime) * (height - padding * 2);
  const rangePath = points.map((point, index) => `${index ? "L" : "M"} ${xFor(point.commandPct).toFixed(1)} ${yRange(point.rangeNm).toFixed(1)}`).join(" ");
  const batteryPath = points.map((point, index) => `${index ? "L" : "M"} ${xFor(point.commandPct).toFixed(1)} ${yTime(finiteOrZero(point.batteryEnduranceMin)).toFixed(1)}`).join(" ");
  const fuelPath = points.map((point, index) => `${index ? "L" : "M"} ${xFor(point.commandPct).toFixed(1)} ${yTime(finiteOrZero(point.fuelEnduranceMin)).toFixed(1)}`).join(" ");
  return (
    <div className="jet-curve-wrap">
      <svg className="jet-curve hybrid-range-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hybrid best range by command thrust">
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />
        <line x1={padding} x2={padding} y1={padding} y2={height - padding} />
        {[10, 30, 50, 70, 90, 100].map((pct) => (
          <text key={pct} x={xFor(pct)} y={height - 10}>{pct}%</text>
        ))}
        <text x={padding} y={22}>range / time</text>
        <path className="range" d={rangePath} />
        <path className="battery" d={batteryPath} />
        <path className="fuel" d={fuelPath} />
        {points.map((point) => (
          <g key={point.commandPct}>
            <circle className={point.enduranceLimiter === "fuel" ? "fuel" : "battery"} cx={xFor(point.commandPct)} cy={yRange(point.rangeNm)} r={4} />
            {point.commandPct === comparison.bestRangeCommand.commandPct ? (
              <circle className="best" cx={xFor(point.commandPct)} cy={yRange(point.rangeNm)} r={8} />
            ) : null}
          </g>
        ))}
      </svg>
      <div className="jet-curve-legend">
        <span><i className="range" /> range</span>
        <span><i className="battery" /> battery time</span>
        <span><i className="fuel" /> fuel time</span>
        <span>dot color shows the limiter at each command</span>
      </div>
    </div>
  );
}

function marginLabel(valuePct: number) {
  if (valuePct >= 25) return "healthy excess";
  if (valuePct >= 0) return "thin excess";
  return "below target";
}

function marginTone(valuePct: number): "good" | "caution" | "bad" {
  if (valuePct >= 25) return "good";
  if (valuePct >= 0) return "caution";
  return "bad";
}

function formatMinutes(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)} min` : "-";
}

function formatPower(valueW: number) {
  if (!Number.isFinite(valueW)) return "-";
  return valueW >= 1000 ? `${(valueW / 1000).toFixed(1)} kW` : `${valueW.toFixed(0)} W`;
}

function formatGain(gain: { delta: number; pct: number | null }, unit: string) {
  if (!Number.isFinite(gain.delta)) return "-";
  const sign = gain.delta >= 0 ? "+" : "";
  const pct = gain.pct === null || !Number.isFinite(gain.pct) ? "" : ` / ${sign}${gain.pct.toFixed(1)}%`;
  return `${sign}${gain.delta.toFixed(1)} ${unit}${pct}`;
}

function formatSignedPair(value: number, pct: number) {
  if (!Number.isFinite(value) || !Number.isFinite(pct)) return "-";
  const valueSign = value >= 0 ? "+" : "";
  const pctSign = pct >= 0 ? "+" : "";
  return `${valueSign}${value.toFixed(2)} / ${pctSign}${pct.toFixed(0)}%`;
}

function limiterLabel(limiter: JetCondition["enduranceLimiter"]) {
  if (limiter === "battery") return "battery";
  if (limiter === "fuel") return "fuel";
  return "-";
}

function limiterSuffix(limiter: JetCondition["enduranceLimiter"]) {
  if (limiter === "battery") return "battery";
  if (limiter === "fuel") return "fuel";
  return "";
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}
