import { Gauge, Rocket, Zap } from "lucide-react";
import type { PropulsionTabState } from "../../app/types";
import { computeMaxOptimization } from "../../maxOptimizer";
import type { MaxOptimizationCandidate } from "../../maxOptimizer";
import type { SizingProject } from "../../sizing";
import { Metric, MetricTile, ResultGroup } from "../ui/Metric";

export function MaxDashboard({
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
  const result = computeMaxOptimization({
    aircraftMassKg,
    batteryEnergyDensityWhKg,
    propulsionState,
    sizingProject,
  });
  const best = result.results[0];
  return (
    <main className="propulsion-workspace max-workspace">
      <section className="propulsion-panel max-summary-panel">
        <div className="propulsion-title">
          <Rocket size={20} />
          <h2>Max Range Optimizer</h2>
        </div>
        <p className="propulsion-demand-explainer">
          Fixed aircraft and payload. Ranks hybrid combinations by range, but prefers matched fuel and battery depletion and rejects prop pitch overspeed.
        </p>
        <div className="max-summary-grid">
          <MetricTile label="Basic aircraft" value={`${result.baseAircraftMassKg.toFixed(2)} kg`} />
          <MetricTile label="Fixed payload" value={`${result.fixedPayloadKg.toFixed(2)} kg`} />
          <MetricTile label="Current variable package" value={`${result.variableMassBaselineKg.toFixed(2)} kg`} />
          <MetricTile label="Minimum battery" value={result.minimumBatteryMassKg > 0 ? `${result.minimumBatteryMassKg.toFixed(2)} kg` : "open"} />
          <MetricTile label="Rotor envelope" value={result.rotorDiameterM > 0 ? `${(result.rotorDiameterM * 1000).toFixed(0)} mm` : "not drawn"} />
          <MetricTile label="Combos evaluated" value={`${result.evaluatedCount}`} />
        </div>
      </section>

      {best ? (
        <section className={`propulsion-panel max-best-panel ${best.status}`}>
          <div className="propulsion-title">
            <Gauge size={20} />
            <h2>Best Range Candidate</h2>
          </div>
          <div className="propulsion-result-groups compact">
            <ResultGroup title="Result">
              <Metric label="Range" value={`${best.rangeNm.toFixed(1)} nm`} />
              <Metric label="Speed" value={`${best.speedKt.toFixed(1)} kt`} />
              <Metric label="Command" value={`${best.commandPct.toFixed(0)}%`} />
              <Metric label="Limiter" value={best.limiter} />
            </ResultGroup>
            <ResultGroup title="Package">
              <Metric label="Battery" value={best.batteryName} />
              <Metric label="Battery mass" value={`${best.batteryMassKg.toFixed(2)} kg`} />
              <Metric label="Motor" value={`${best.motorName}, ${best.motorPowerKw.toFixed(1)} kW`} />
              <Metric label="Prop dia" value={`${best.propellerDiameterM.toFixed(2)} m`} />
              <Metric label="Jet" value={best.engineName} />
            </ResultGroup>
            <ResultGroup title="Mass & Fuel">
              <Metric label="Total mass" value={`${best.massKg.toFixed(2)} kg`} />
              <Metric label="Base aircraft" value={`${result.baseAircraftMassKg.toFixed(2)} kg`} />
              <Metric label="Battery mass" value={`${best.batteryMassKg.toFixed(2)} kg`} />
              <Metric label="Motor + prop mass" value={`${(best.motorMassKg + best.propellerMassKg).toFixed(2)} kg`} />
              <Metric label="Jet mass" value={`${best.engineMassKg.toFixed(2)} kg`} />
              <Metric label="Fuel mass" value={`${best.fuelMassKg.toFixed(2)} kg`} />
              <Metric label="Takeoff T/W" value={best.thrustToWeight.toFixed(2)} />
            </ResultGroup>
            <ResultGroup title="Margins">
              <Metric label="Battery time" value={formatMinutes(best.batteryTimeMin)} />
              <Metric label="Fuel time" value={formatMinutes(best.fuelTimeMin)} />
              <Metric label="Energy match" value={`${best.energyBalancePct.toFixed(0)}% apart`} />
              <Metric label="Pitch overspeed" value={best.pitchOverspeedPct > 0.5 ? `+${best.pitchOverspeedPct.toFixed(0)}%` : "none"} />
              <Metric label="Warnings" value={best.warnings.length ? best.warnings.join(", ") : "clean"} />
            </ResultGroup>
          </div>
        </section>
      ) : null}

      <section className="propulsion-panel max-results-panel">
        <div className="propulsion-title">
          <Zap size={20} />
          <h2>Ranked Combinations</h2>
        </div>
        <div className="max-result-table">
          <div className="max-result-row header">
            <span>Rank</span>
            <span>Range</span>
            <span>Speed</span>
            <span>Package</span>
            <span>Total mass</span>
            <span>Battery mass</span>
            <span>Motor kW</span>
            <span>Prop dia</span>
            <span>Fuel</span>
            <span>Match</span>
            <span>T/W</span>
            <span>Notes</span>
          </div>
          {result.results.map((candidate, index) => (
            <MaxResultRow candidate={candidate} index={index} key={`${candidate.engineName}-${candidate.batteryName}-${candidate.motorName}-${candidate.propellerName}-${candidate.fuelMassKg}`} />
          ))}
        </div>
      </section>
    </main>
  );
}

function MaxResultRow({ candidate, index }: { candidate: MaxOptimizationCandidate; index: number }) {
  return (
    <div className={`max-result-row ${candidate.status}`}>
      <span>#{index + 1}</span>
      <strong>{candidate.rangeNm.toFixed(1)} nm</strong>
      <span>{candidate.speedKt.toFixed(1)} kt</span>
      <span>
        <b>{candidate.engineName}</b>
        <small>{candidate.motorName}, {candidate.propellerName}</small>
      </span>
      <span>{candidate.massKg.toFixed(1)} kg</span>
      <span>
        {candidate.batteryMassKg.toFixed(1)} kg
        <small>{candidate.batteryName}, {formatMinutes(candidate.batteryTimeMin)}</small>
      </span>
      <span>{candidate.motorPowerKw.toFixed(1)} kW</span>
      <span>{candidate.propellerDiameterM.toFixed(2)} m</span>
      <span>
        {candidate.fuelMassKg.toFixed(1)} kg
        <small>{formatMinutes(candidate.fuelTimeMin)}</small>
      </span>
      <span>{candidate.energyBalancePct.toFixed(0)}%</span>
      <span>{candidate.thrustToWeight.toFixed(2)}</span>
      <span>{candidate.warnings.length ? candidate.warnings.join(", ") : "clean"}</span>
    </div>
  );
}

function formatMinutes(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)} min` : "-";
}
