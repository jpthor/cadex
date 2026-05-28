import type { SelectedGeometry } from "../../types";
import { formatVector, type DisplayUnit } from "./units";

export function SelectionTable({
  precision,
  selectedGeometry,
  unit,
}: {
  precision: number;
  selectedGeometry: SelectedGeometry;
  unit: DisplayUnit;
}) {
  const rows = [
    ["Type", selectedGeometry.type],
    ["Object", selectedGeometry.objectName ?? "Base construction plane"],
    ["Position", formatVector(selectedGeometry.position, unit, precision)],
  ];
  if (selectedGeometry.normal) rows.push(["Normal", selectedGeometry.normal.map((value) => value.toFixed(3)).join(", ")]);

  return (
    <div className="parameter-table">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
