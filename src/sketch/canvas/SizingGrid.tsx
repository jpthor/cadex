import type { CanvasView, ScaleUnit } from "../types";
import {
  chooseMajorTickMeters,
  chooseMinorTickMeters,
  clamp,
  formatScaleValue,
  fromCanvas,
  isMultipleOf,
  isPointVisible,
  snapNumber,
  toCanvas,
} from "../geometry";
import { scaleUnits } from "../constants";
export function SizingGrid({
  view,
  unit,
  onSetUnit,
  xAxisLabel = "X",
  yAxisLabel = "Y",
}: {
  view: CanvasView;
  unit: ScaleUnit;
  onSetUnit: (unit: ScaleUnit) => void;
  xAxisLabel?: string;
  yAxisLabel?: string;
}) {
  const majorTickM = chooseMajorTickMeters(view.scale);
  const minorTickM = chooseMinorTickMeters(majorTickM);
  const gridLines = [];
  const axisTicks = [];
  const stickyAxisX = clamp(view.originX, 28, view.width - 28);
  const stickyAxisY = clamp(view.originY, 30, view.height - 30);
  const yAxisHeaderY = 76;
  const firstX = Math.floor(fromCanvas(0, stickyAxisY, view).xM / minorTickM) * minorTickM;
  const lastX = Math.ceil(fromCanvas(view.width, stickyAxisY, view).xM / minorTickM) * minorTickM;
  const firstY = Math.floor(fromCanvas(stickyAxisX, view.height, view).yM / minorTickM) * minorTickM;
  const lastY = Math.ceil(fromCanvas(stickyAxisX, 0, view).yM / minorTickM) * minorTickM;

  for (let xM = firstX; xM <= lastX; xM += minorTickM) {
    const normalized = snapNumber(xM, minorTickM);
    const isMajor = isMultipleOf(normalized, majorTickM);
    const x = toCanvas({ xM, yM: 0 }, view).x;
    gridLines.push(<line className={isMajor ? "major" : "minor"} key={`v-${normalized}`} x1={x} y1="0" x2={x} y2={view.height} />);
    if (isMajor && Math.abs(normalized) > 0.0001) {
      axisTicks.push(
        <g key={`xt-${normalized}`}>
          <line x1={x} y1={stickyAxisY - 5} x2={x} y2={stickyAxisY + 5} />
          <text x={x + 4} y={stickyAxisY + 18}>{formatScaleValue(normalized, unit)}</text>
        </g>,
      );
    }
  }

  for (let yM = firstY; yM <= lastY; yM += minorTickM) {
    const normalized = snapNumber(yM, minorTickM);
    const isMajor = isMultipleOf(normalized, majorTickM);
    const y = toCanvas({ xM: 0, yM }, view).y;
    gridLines.push(<line className={isMajor ? "major" : "minor"} key={`h-${normalized}`} x1="0" y1={y} x2={view.width} y2={y} />);
    if (isMajor && Math.abs(normalized) > 0.0001) {
      axisTicks.push(
        <g key={`yt-${normalized}`}>
          <line x1={stickyAxisX - 5} y1={y} x2={stickyAxisX + 5} y2={y} />
          <text x={stickyAxisX + 10} y={y - 5}>{formatScaleValue(normalized, unit)}</text>
        </g>,
      );
    }
  }

  return (
    <>
      <g className="sizing-grid">{gridLines}</g>
      <g className="sizing-axes">
        <line x1="0" y1={stickyAxisY} x2={view.width} y2={stickyAxisY} />
        <line x1={stickyAxisX} y1="0" x2={stickyAxisX} y2={view.height} />
        {axisTicks}
        <text className="axis-name" x={view.width - 46} y={stickyAxisY - 10}>{xAxisLabel}</text>
        <text className="axis-name" x={stickyAxisX + 12} y={yAxisHeaderY}>{yAxisLabel}</text>
        <g className="axis-unit-options">
          <title>Canvas units</title>
          {scaleUnits.map((option, index) => (
            <text
              className={`axis-unit-option ${unit === option ? "active" : ""}`}
              key={option}
              onClick={() => onSetUnit(option)}
              x={stickyAxisX + 34 + index * 28}
              y={yAxisHeaderY}
            >
              {option}
            </text>
          ))}
        </g>
      </g>
    </>
  );
}
