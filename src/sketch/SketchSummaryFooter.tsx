import type { SizingAnalysis } from "../sizing";

export function SketchSummaryFooter({ analysis }: { analysis?: SizingAnalysis }) {
  if (!analysis) {
    return (
      <>
        <span>Live sizing</span>
        <span>CoM, CoP, inertia, geometry</span>
      </>
    );
  }
  return (
    <>
      <span>MTOW {analysis.totalMassKg.toFixed(1)} kg</span>
      <span>Static margin {analysis.staticMarginPct.toFixed(1)}%</span>
      {analysis.warnings[0] ? <span className="sizing-warning-text">{analysis.warnings[0]}</span> : null}
    </>
  );
}
