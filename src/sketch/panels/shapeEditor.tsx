import { Trash2 } from "lucide-react";
import {
  bodyMaterialLabels,
  liftingSurfaceKindLabels,
  partTypeLabels,
} from "../../sizing";
import type {
  BodyMaterial,
  LiftingSurfaceKind,
  SizeShape,
  SizingProject,
} from "../../sizing";
import { airfoilOptions, defaultAirfoilForLiftingSurface } from "../constants";
import type { AirfoilStation } from "../types";
import {
  batteryMassEstimate,
  batteryPlanformAreaEstimate,
  batteryVolumeEstimate,
  bodyMassEstimate,
  bodySurfaceAreaEstimate,
  inferredBatteryThicknessM,
  liftingSurfaceMassEstimate,
  liftingSurfaceSkinAreaEstimate,
  liftingSurfaceStats,
  motorMassEstimate,
  motorDiameterEstimateM,
  motorLengthEstimateM,
  motorVolumeEstimate,
  rotorDiameterEstimate,
  rotorInstanceCount,
  rotorMassPerRotorEstimate,
  rotorTotalMassEstimate,
  rotorVolumePerRotorEstimate,
  shapeBounds,
} from "../../sizing/auditedSizingEngine";
import { partTouchesMirrorAxis } from "../diagnostics";
import { referenceRoles } from "../constants";
import { cadGeometryForShape, implicitMirrorShapeId, motorDepthM, verticalReferenceX } from "../geometry";
import { NumberField, SketchPanelTitle } from "./shared";
export function ShapeSelector({
  selectedShapeId,
  shapes,
  onSelect,
}: {
  selectedShapeId: string;
  shapes: SizeShape[];
  onSelect: (shapeId: string) => void;
}) {
  return (
    <label className="sizing-field shape-selector">
      <span>Shape</span>
      <select value={selectedShapeId} onChange={(event) => onSelect(event.target.value)}>
        <option value="">Select shape</option>
        {shapes.map((shape) => (
          <option key={shape.id} value={shape.id}>
            {shape.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ShapeEditor({
  activeAirfoilStation,
  mirrorPlanes,
  shapes,
  shape,
  suggestedRows = [],
  onActiveAirfoilStationChange,
  onChange,
  onDelete,
}: {
  activeAirfoilStation: AirfoilStation;
  mirrorPlanes: SizeShape[];
  shapes: SizeShape[];
  shape: SizeShape;
  suggestedRows?: Array<{ label: string; value: string }>;
  onActiveAirfoilStationChange: (station: AirfoilStation) => void;
  onChange: (patch: Partial<SizeShape>) => void;
  onDelete: () => void;
}) {
  const bounds = shapeBounds(shape);
  const motorDiameter = shape.partType === "motor" ? motorDiameterEstimateM(shape) : 0;
  const motorLength = shape.partType === "motor" ? motorLengthEstimateM(shape) : 0;
  const motorDepth = shape.partType === "motor" ? motorDepthM(shape) : 0;
  const motorCount = shape.partType === "motor" && partTouchesMirrorAxis(shape) ? 1 : 2;
  const motorVolumeM3 = shape.partType === "motor" ? motorVolumeEstimate(shape) : 0;
  const motorMassKg = shape.partType === "motor" ? motorMassEstimate(shape) : 0;
  const relatedShapes = shapes.length ? shapes : mirrorPlanes;
  const sideViewStationOptions = sideViewStationAnchorOptions(shape, relatedShapes);
  const selectedSideViewStation = sideViewStationOptions.find((option) => option.id === (shape.sideViewStationId ?? implicitMirrorShapeId));
  const zStationOptions = zStationAnchorOptions(shape, relatedShapes);
  const selectedZStation = zStationOptions.find((option) => option.id === (shape.zStationId ?? ""));
  const cadGeometry = cadGeometryForShape(shape, relatedShapes);
  const liftingStats = shape.role === "liftingSurface" ? liftingSurfaceStats(shape, relatedShapes) : undefined;
  const drawnLiftingAreaM2 = shape.role === "liftingSurface" ? polygonAreaM2(shape.points) : 0;
  const drawnLiftingSpanM = shape.role === "liftingSurface" ? Math.max(bounds.maxX - bounds.minX, 0) : 0;
  const mirroredLiftingSpanM = shape.role === "liftingSurface" && bounds.minX > 0.005 ? drawnLiftingSpanM * 2 : drawnLiftingSpanM;
  const liftingAreaScope =
    shape.role === "liftingSurface"
      ? liftingStats && Math.abs(liftingStats.areaM2 - drawnLiftingAreaM2) <= 0.001
        ? "Drawn area only"
        : "Effective aircraft area after mirrors"
      : "";
  const comparisonCurrentRows = suggestedRows.length ? currentRowsForSuggestedLabels(shape, relatedShapes, suggestedRows) : [];
  return (
    <div className="component-editor">
      <label className="sizing-field">
        <span>Label</span>
        <input value={shape.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>
      {shape.sketchViewMode === "side" ? (
        <label className="sizing-field">
          <span>Y station</span>
          <select value={shape.sideViewStationId ?? implicitMirrorShapeId} onChange={(event) => onChange({ sideViewStationId: event.target.value })}>
            {sideViewStationOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {(shape.sketchViewMode ?? "top") === "top" && referenceRoles.includes(shape.role) ? (
        <label className="sizing-field">
          <span>Z station</span>
          <select value={shape.zStationId ?? ""} onChange={(event) => onChange({ zStationId: event.target.value || undefined })}>
            {zStationOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {shape.role === "liftingSurface" ? (
        <>
          <div className="segmented-control sizing-role-control" aria-label="Lifting surface role">
            {Object.entries(liftingSurfaceKindLabels).map(([kind, label]) => (
              <button
                className={(shape.liftingSurfaceKind ?? "wing") === kind ? "active" : ""}
                key={kind}
                onClick={() => {
                  const nextKind = kind as LiftingSurfaceKind;
                  const defaultAirfoil = defaultAirfoilForLiftingSurface(nextKind);
                  onChange({
                    airfoil: defaultAirfoil,
                    airfoilStations: { root: defaultAirfoil, tip: defaultAirfoil },
                    liftingSurfaceKind: nextKind,
                  });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {shape.liftingSurfaceKind !== "lex" ? <div className="airfoil-panel">
            <div className="segmented-control sizing-role-control" aria-label="Aerofoil station">
              <button className={activeAirfoilStation === "root" ? "active" : ""} onClick={() => onActiveAirfoilStationChange("root")}>
                Root
              </button>
              <button className={activeAirfoilStation === "tip" ? "active" : ""} onClick={() => onActiveAirfoilStationChange("tip")}>
                Tip
              </button>
            </div>
            <label className="sizing-field">
              <span>Aerofoil</span>
              <select
                value={stationAirfoil(shape, activeAirfoilStation)}
                onChange={(event) =>
                  onChange({
                    airfoil: event.target.value,
                    airfoilStations: {
                      root: stationAirfoil(shape, "root"),
                      tip: stationAirfoil(shape, "tip"),
                      [activeAirfoilStation]: event.target.value,
                    },
                  })
                }
              >
                {airfoilOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div> : null}
          <label className="sizing-field">
            <span>Material</span>
            <select
              value={shape.bodyMaterial ?? "carbonFibre"}
              onChange={(event) => onChange({ bodyMaterial: event.target.value as BodyMaterial })}
            >
              {Object.entries(bodyMaterialLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {shape.liftingSurfaceKind !== "lex" ? <NumberField
            label={`${activeAirfoilStation === "root" ? "Root" : "Tip"} incidence`}
            suffix="deg"
            value={stationIncidence(shape, activeAirfoilStation)}
            step={0.1}
            onChange={(incidenceDeg) =>
              onChange({
                incidenceDeg: ((activeAirfoilStation === "root" ? incidenceDeg : stationIncidence(shape, "root")) +
                  (activeAirfoilStation === "tip" ? incidenceDeg : stationIncidence(shape, "tip"))) / 2,
                incidenceStationsDeg: {
                  root: stationIncidence(shape, "root"),
                  tip: stationIncidence(shape, "tip"),
                  [activeAirfoilStation]: incidenceDeg,
                },
              })
            }
          /> : null}
          {shape.liftingSurfaceKind !== "lex" ? <div className="shape-readout">
            <span>
              Twist {(stationIncidence(shape, "tip") - stationIncidence(shape, "root")).toFixed(1)} deg
            </span>
          </div> : null}
          <NumberField
            label="Thickness"
            suffix="mm"
            value={shape.bodyThicknessMm ?? 1.2}
            step={0.1}
            onChange={(bodyThicknessMm) => onChange({ bodyThicknessMm })}
          />
          {!suggestedRows.length ? (
            <ReadoutCard
              title="Current surface"
              rows={[
                { label: "Span", value: formatMm(drawnLiftingSpanM) },
                ...(mirroredLiftingSpanM > drawnLiftingSpanM + 0.001 ? [{ label: "Mirrored span", value: formatMm(mirroredLiftingSpanM) }] : []),
                { label: "Area", value: `${drawnLiftingAreaM2.toFixed(3)} m2` },
                ...(liftingStats ? [{ label: liftingAreaScope, value: `${liftingStats.areaM2.toFixed(3)} m2` }] : []),
                { label: "Skin area", value: `${liftingSurfaceSkinAreaEstimate(shape, relatedShapes).toFixed(3)} m2` },
                { label: "Mass", value: `${liftingSurfaceMassEstimate(shape, relatedShapes).toFixed(3)} kg` },
              ]}
            />
          ) : null}
        </>
      ) : shape.role === "body" ? (
        <>
          <label className="sizing-field">
            <span>Material</span>
            <select
              value={shape.bodyMaterial ?? "carbonFibre"}
              onChange={(event) => onChange({ bodyMaterial: event.target.value as BodyMaterial })}
            >
              {Object.entries(bodyMaterialLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Thickness"
            suffix="mm"
            value={shape.bodyThicknessMm ?? 1.2}
            step={0.1}
            onChange={(bodyThicknessMm) => onChange({ bodyThicknessMm })}
          />
          <div className="shape-readout">
            <span>Planform skin area {bodySurfaceAreaEstimate(shape, relatedShapes).toFixed(3)} m2</span>
            <span>Body mass {bodyMassEstimate(shape, relatedShapes).toFixed(3)} kg</span>
          </div>
        </>
      ) : referenceRoles.includes(shape.role) ? (
        <div className="shape-readout">
          <span>{shape.role === "mirrorPlane" ? "Mirrors touching geometry before origin mirror" : "Reference snap line"}</span>
          {shape.sketchViewMode === "side" ? <span>Aircraft Y station {selectedSideViewStation?.label ?? "Y-axis"}</span> : null}
          {(shape.sketchViewMode ?? "top") === "top" && referenceRoles.includes(shape.role) ? <span>Aircraft Z station {selectedZStation?.label ?? "Z-axis"}</span> : null}
        </div>
      ) : (
        <>
          {shape.partType === "battery" && !suggestedRows.length ? (
            <ReadoutCard
              title="Current battery"
              rows={[
                { label: "Length", value: formatMm(bounds.maxY - bounds.minY) },
                { label: "Width", value: formatMm(bounds.maxX * 2) },
                { label: "Height", value: formatMm(inferredBatteryThicknessM(shape)) },
                { label: "Volume", value: `${(batteryVolumeEstimate(shape) * 1000).toFixed(2)} L` },
                { label: "Mass", value: `${batteryMassEstimate(shape).toFixed(3)} kg` },
              ]}
              notes={[
                `Plan area ${batteryPlanformAreaEstimate(shape).toFixed(4)} m2`,
                partTouchesMirrorAxis(shape) ? "1 centerline battery, mirrored from X axis" : "2 mirrored batteries",
                "LiPo density 1.70 kg/L",
              ]}
            />
          ) : shape.partType === "motor" && !suggestedRows.length ? (
            <ReadoutCard
              title="Current motor"
              rows={[
                { label: "Diameter", value: `${(motorDiameter * 1000).toFixed(0)} mm` },
                { label: "Length", value: `${(motorLength * 1000).toFixed(0)} mm` },
                { label: "Depth", value: `${(motorDepth * 1000).toFixed(0)} mm` },
                { label: "Volume", value: `${(motorVolumeM3 * 1000).toFixed(2)} L` },
                { label: "Mass / motor", value: `${(motorMassKg / Math.max(motorCount, 1)).toFixed(3)} kg` },
                { label: "Total mass", value: `${motorMassKg.toFixed(3)} kg` },
              ]}
              notes={["Motor density 3.20 kg/L", ...(cadGeometry?.kind === "cylinder" ? ["Axis follows motor length"] : [])]}
            />
          ) : shape.partType === "rotor" && !suggestedRows.length ? (
            <>
              <ReadoutCard
                title="Current rotor"
                rows={[
                  { label: "Diameter", value: `${(rotorDiameterEstimate(shape, relatedShapes) * 1000).toFixed(0)} mm` },
                  { label: "Blade count", value: `${Math.max(1, Math.round(shape.rotorBladeCount ?? 2))}` },
                  { label: "Physical count", value: `${rotorInstanceCount(shape, relatedShapes)}` },
                  { label: "Volume / rotor", value: `${(rotorVolumePerRotorEstimate(shape, relatedShapes) * 1000).toFixed(3)} L` },
                  { label: "Mass / rotor", value: `${rotorMassPerRotorEstimate(shape, relatedShapes).toFixed(3)} kg` },
                  { label: "Total mass", value: `${rotorTotalMassEstimate(shape, relatedShapes).toFixed(3)} kg` },
                ]}
                notes={["Carbon fibre density 1.60 kg/L"]}
              />
            </>
          ) : !suggestedRows.length ? (
            <NumberField label="Mass" suffix="kg" value={shape.massKg ?? 0} onChange={(massKg) => onChange({ massKg })} />
          ) : null}
        </>
      )}
      {suggestedRows.length ? (
        <ComparisonReadout currentRows={comparisonCurrentRows} suggestedRows={suggestedRows} />
      ) : null}
      <div className="shape-readout shape-geometry-readout">
        <strong>Geometry</strong>
        <span>
          <span>Points</span>
          <b>{shape.points.length}</b>
        </span>
        {shape.partType === "motor" ? (
          <>
            <span>
              <span>Physical motors</span>
              <b>{motorCount}</b>
            </span>
            <span>
              <span>Axis length</span>
              <b>{formatMm(motorLength)}</b>
            </span>
          </>
        ) : (
          <>
            <span>
              <span>Mirrored width</span>
              <b>{formatMm(bounds.maxX * 2)}</b>
            </span>
            <span>
              <span>Length</span>
              <b>{formatMm(bounds.maxY - bounds.minY)}</b>
            </span>
          </>
        )}
      </div>
      <button className="delete-component-button" onClick={onDelete}>
        <Trash2 size={15} />
        Delete shape
      </button>
    </div>
  );
}

function ReadoutCard({
  notes = [],
  rows,
  title,
}: {
  notes?: string[];
  rows: Array<{ label: string; value: string }>;
  title: string;
}) {
  return (
    <div className="shape-readout shape-metric-card">
      <strong>{title}</strong>
      {rows.map((row) => (
        <span key={row.label}>
          <span>{row.label}</span>
          <b>{row.value}</b>
        </span>
      ))}
      {notes.length ? (
        <div className="shape-readout-notes">
          {notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ComparisonReadout({
  currentRows,
  suggestedRows,
}: {
  currentRows: Array<{ label: string; value: string }>;
  suggestedRows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="shape-readout shape-metric-card shape-comparison-card">
      <div className="shape-comparison-header">
        <span />
        <b>Current</b>
        <b>Suggested</b>
      </div>
      {suggestedRows.map((row, index) => (
        <div className="shape-comparison-row" key={row.label}>
          <span>{row.label}</span>
          <b>{currentRows[index]?.value ?? "-"}</b>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}

function currentRowsForSuggestedLabels(
  shape: SizeShape,
  shapes: SizeShape[],
  suggestedRows: Array<{ label: string; value: string }>,
) {
  const bounds = shapeBounds(shape);
  const stats = shape.role === "liftingSurface" ? liftingSurfaceStats(shape, shapes) : undefined;
  const mirroredLifting = shape.role === "liftingSurface" && bounds.minX > 0.005;
  const liftingAreaPerSide = stats ? (mirroredLifting ? stats.areaM2 / 2 : stats.areaM2) : 0;

  function valueFor(label: string) {
    if (shape.role === "liftingSurface" && stats) {
      const kind = shape.liftingSurfaceKind ?? "wing";
      if (label === "Span") return formatDimension(stats.spanM);
      if (label === "Half-span") return formatDimension(stats.spanM / 2);
      if (label === "Root depth") return `${formatDimension(Math.abs(bounds.minY))} from nose`;
      if (label === "Mean chord") return formatDimension(stats.chordM);
      if (
        label === "Total wing area" ||
        label === "Total tailplane area" ||
        label === "Total area (2 tailplanes)" ||
        label === "Total fin area" ||
        label === "Total area (2 fins)" ||
        label === "Total LEX area" ||
        label === "Total area"
      ) {
        return `${stats.areaM2.toFixed(3)} m2`;
      }
      if (label === "Span / tailplane" || label === "Span (one tailplane)") return formatDimension(Math.max(bounds.maxX - bounds.minX, 0.05));
      if (label === "Mean chord / tailplane" || label === "Mean chord (one tailplane)") return formatDimension(liftingAreaPerSide / Math.max(bounds.maxX - bounds.minX, 0.01));
      if (label === "Area / tailplane" || label === "Area (one tailplane)" || label === "Area / fin" || label === "Area (one fin)") return `${Math.max(liftingAreaPerSide, 0).toFixed(3)} m2`;
      if (label === "Height") return formatDimension(kind === "fin" ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY);
      if (label === "Chord") return formatDimension(bounds.maxY - bounds.minY);
      if (label === "Length") return formatDimension(bounds.maxY - bounds.minY);
      if (label === "Half-width") return formatDimension(Math.max(bounds.maxX - bounds.minX, 0));
      if (label === "Mirrored width") return formatDimension(Math.max(bounds.maxX, 0) * 2);
      if (label === "Airfoil") return shape.airfoil ?? "NACA 0012";
    }

    if (shape.role === "part") {
      if (shape.partType === "battery") {
        if (label === "Length") return formatDimension(bounds.maxY - bounds.minY);
        if (label === "Width") return formatDimension(bounds.maxX * 2);
        if (label === "Height") return formatDimension(inferredBatteryThicknessM(shape));
        if (label === "Volume") return `${(batteryVolumeEstimate(shape) * 1000).toFixed(2)} L`;
        if (label === "Mass") return `${batteryMassEstimate(shape).toFixed(3)} kg`;
      }
      if (shape.partType === "motor") {
        if (label === "Diameter") return formatDimension(motorDiameterEstimateM(shape));
        if (label === "Length") return formatDimension(motorLengthEstimateM(shape));
        if (label === "Depth") return formatDimension(motorDepthM(shape));
        if (label === "Total motor mass") return `${motorMassEstimate(shape).toFixed(3)} kg`;
      }
      if (shape.partType === "rotor") {
        if (label === "Diameter") return formatDimension(rotorDiameterEstimate(shape, shapes));
        if (label === "Blades") return `${Math.max(1, Math.round(shape.rotorBladeCount ?? 2))}`;
        if (label === "Physical count") return `${rotorInstanceCount(shape, shapes)}`;
      }
      if (label === "Length") return formatDimension(bounds.maxY - bounds.minY);
      if (label === "Width") return formatDimension(bounds.maxX * 2);
      if (label === "Mass") return `${(shape.massKg ?? 0).toFixed(3)} kg`;
    }

    return "-";
  }

  return suggestedRows.map((row) => ({ label: row.label, value: valueFor(row.label) }));
}

function formatMm(valueM: number) {
  return `${Math.round(Math.abs(valueM) * 1000)} mm`;
}

function formatDimension(valueM: number) {
  if (!Number.isFinite(valueM)) return "-";
  const magnitude = Math.abs(valueM);
  return magnitude >= 1 ? `${magnitude.toFixed(2)} m` : `${Math.round(magnitude * 1000)} mm`;
}

function stationAirfoil(shape: SizeShape, station: AirfoilStation) {
  if (station === "root") return shape.airfoilStations?.root ?? shape.airfoilStations?.root10 ?? shape.airfoil ?? "NACA 0012";
  return shape.airfoilStations?.tip ?? shape.airfoilStations?.tip90 ?? shape.airfoil ?? "NACA 0012";
}

function stationIncidence(shape: SizeShape, station: AirfoilStation) {
  if (station === "root") return shape.incidenceStationsDeg?.root ?? shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? 0;
  return shape.incidenceStationsDeg?.tip ?? shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? 0;
}

function sideViewStationAnchorOptions(shape: SizeShape, shapes: SizeShape[]) {
  const options = [{ id: implicitMirrorShapeId, label: "Y-axis" }];
  if (shape.sketchViewMode !== "side") return options;
  return [...options, ...topViewStationAnchorOptions(shape, shapes)];
}

function zStationAnchorOptions(shape: SizeShape, shapes: SizeShape[]) {
  const options = [{ id: "", label: "Z-axis" }];
  if ((shape.sketchViewMode ?? "top") !== "top") return options;
  const stations = shapes
    .filter((candidate) => candidate.id !== shape.id && referenceRoles.includes(candidate.role) && candidate.sketchViewMode === "side")
    .map((candidate) => ({ shape: candidate, zM: verticalReferenceX(candidate) }))
    .filter((entry): entry is { shape: SizeShape; zM: number } => entry.zM !== undefined)
    .sort((a, b) => Math.abs(a.zM) - Math.abs(b.zM) || a.shape.label.localeCompare(b.shape.label));
  const stationOptions = stations.map(({ shape: station, zM }) => ({ id: station.id, label: `${station.label} (${formatSignedStation("z", zM)})` }));
  const missingId = shape.zStationId;
  if (missingId && !stationOptions.some((option) => option.id === missingId)) {
    stationOptions.push({ id: missingId, label: "Missing Z station" });
  }
  return [...options, ...stationOptions];
}

function topViewStationAnchorOptions(shape: SizeShape, shapes: SizeShape[]) {
  const options: Array<{ id: string; label: string }> = [];
  const stations = shapes
    .filter((candidate) => candidate.id !== shape.id && referenceRoles.includes(candidate.role) && (candidate.sketchViewMode ?? "top") === "top")
    .map((candidate) => ({ shape: candidate, xM: verticalReferenceX(candidate) }))
    .filter((entry): entry is { shape: SizeShape; xM: number } => entry.xM !== undefined)
    .sort((a, b) => Math.abs(a.xM) - Math.abs(b.xM) || a.shape.label.localeCompare(b.shape.label));
  for (const { shape: station, xM } of stations) {
    options.push({ id: station.id, label: `${station.label} (${formatSignedStation("y", xM)})` });
  }
  const missingId = shape.sketchViewMode === "side" ? shape.sideViewStationId : shape.dihedralBreakStationId;
  if (missingId && !options.some((option) => option.id === missingId)) {
    options.push({ id: missingId, label: "Missing station" });
  }
  return options;
}

function formatSignedStation(axis: "x" | "y" | "z", valueM: number) {
  const mm = Math.round(valueM * 1000);
  if (mm === 0) return `${axis}=0`;
  return `${axis}=${mm > 0 ? "+" : ""}${mm} mm`;
}

function polygonAreaM2(points: SizeShape["points"]) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.xM * next.yM - next.xM * current.yM;
  }
  return Math.abs(area) / 2;
}
