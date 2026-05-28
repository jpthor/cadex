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
import { airfoilOptions } from "../constants";
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
import { cadGeometryForShape, motorDepthM } from "../geometry";
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
  shape,
  onActiveAirfoilStationChange,
  onChange,
  onDelete,
}: {
  activeAirfoilStation: AirfoilStation;
  mirrorPlanes: SizeShape[];
  shape: SizeShape;
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
  const cadGeometry = cadGeometryForShape(shape);
  const liftingStats = shape.role === "liftingSurface" ? liftingSurfaceStats(shape, mirrorPlanes) : undefined;
  const drawnLiftingAreaM2 = shape.role === "liftingSurface" ? polygonAreaM2(shape.points) : 0;
  const drawnLiftingSpanM = shape.role === "liftingSurface" ? Math.max(bounds.maxX - bounds.minX, 0) : 0;
  const mirroredLiftingSpanM = shape.role === "liftingSurface" && bounds.minX > 0.005 ? drawnLiftingSpanM * 2 : drawnLiftingSpanM;
  const liftingAreaScope =
    shape.role === "liftingSurface"
      ? liftingStats && Math.abs(liftingStats.areaM2 - drawnLiftingAreaM2) <= 0.001
        ? "Drawn area only"
        : "Effective aircraft area after mirrors"
      : "";
  return (
    <div className="component-editor">
      <label className="sizing-field">
        <span>Label</span>
        <input value={shape.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>
      {shape.role === "liftingSurface" ? (
        <>
          <div className="segmented-control sizing-role-control" aria-label="Lifting surface role">
            {Object.entries(liftingSurfaceKindLabels).map(([kind, label]) => (
              <button
                className={(shape.liftingSurfaceKind ?? "wing") === kind ? "active" : ""}
                key={kind}
                onClick={() => onChange({ liftingSurfaceKind: kind as LiftingSurfaceKind })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="airfoil-panel">
            <div className="segmented-control sizing-role-control" aria-label="Aerofoil station">
              <button className={activeAirfoilStation === "root10" ? "active" : ""} onClick={() => onActiveAirfoilStationChange("root10")}>
                10%
              </button>
              <button className={activeAirfoilStation === "tip90" ? "active" : ""} onClick={() => onActiveAirfoilStationChange("tip90")}>
                90%
              </button>
            </div>
            <label className="sizing-field">
              <span>Aerofoil</span>
              <select
                value={shape.airfoilStations?.[activeAirfoilStation] ?? shape.airfoil ?? "NACA 0012"}
                onChange={(event) =>
                  onChange({
                    airfoil: event.target.value,
                    airfoilStations: {
                      root10: shape.airfoilStations?.root10 ?? shape.airfoil ?? "NACA 0012",
                      tip90: shape.airfoilStations?.tip90 ?? shape.airfoil ?? "NACA 0012",
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
          </div>
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
            label={`${activeAirfoilStation === "root10" ? "10%" : "90%"} incidence`}
            suffix="deg"
            value={shape.incidenceStationsDeg?.[activeAirfoilStation] ?? shape.incidenceDeg ?? 0}
            step={0.1}
            onChange={(incidenceDeg) =>
              onChange({
                incidenceDeg: ((activeAirfoilStation === "root10" ? incidenceDeg : shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? 0) +
                  (activeAirfoilStation === "tip90" ? incidenceDeg : shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? 0)) / 2,
                incidenceStationsDeg: {
                  root10: shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? 0,
                  tip90: shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? 0,
                  [activeAirfoilStation]: incidenceDeg,
                },
              })
            }
          />
          <div className="shape-readout">
            <span>
              Twist {((shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? 0) - (shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? 0)).toFixed(1)} deg
            </span>
          </div>
          <NumberField
            label="Thickness"
            suffix="mm"
            value={shape.bodyThicknessMm ?? 1.2}
            step={0.1}
            onChange={(bodyThicknessMm) => onChange({ bodyThicknessMm })}
          />
          <div className="shape-readout">
            <span>Span of drawn surface {(drawnLiftingSpanM * 1000).toFixed(0)} mm</span>
            {mirroredLiftingSpanM > drawnLiftingSpanM + 0.001 ? <span>Combined mirrored surface span {(mirroredLiftingSpanM * 1000).toFixed(0)} mm</span> : null}
            <span>Drawn planform area {drawnLiftingAreaM2.toFixed(3)} m2</span>
            {liftingStats ? <span>{liftingAreaScope} {liftingStats.areaM2.toFixed(3)} m2</span> : null}
            <span>Skin area used for mass {liftingSurfaceSkinAreaEstimate(shape, mirrorPlanes).toFixed(3)} m2</span>
            <span>Surface mass {liftingSurfaceMassEstimate(shape, mirrorPlanes).toFixed(3)} kg</span>
          </div>
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
            <span>Planform skin area {bodySurfaceAreaEstimate(shape).toFixed(3)} m2</span>
            <span>Body mass {bodyMassEstimate(shape).toFixed(3)} kg</span>
          </div>
        </>
      ) : referenceRoles.includes(shape.role) ? (
        <div className="shape-readout">
          <span>{shape.role === "mirrorPlane" ? "Mirrors touching geometry before origin mirror" : "Reference snap line"}</span>
        </div>
      ) : (
        <>
          <div className="shape-readout">
            <span>Part {partTypeLabels[shape.partType ?? "payload"]}</span>
          </div>
          {shape.partType === "battery" ? (
            <div className="shape-readout">
              <span>{partTouchesMirrorAxis(shape) ? "1 centerline battery, mirrored from Y axis" : "2 mirrored batteries"}</span>
              <span>Plan area {batteryPlanformAreaEstimate(shape).toFixed(4)} m2</span>
              <span>Inferred thickness {(inferredBatteryThicknessM(shape) * 1000).toFixed(0)} mm</span>
              <span>Volume {(batteryVolumeEstimate(shape) * 1000).toFixed(2)} L</span>
              <span>Battery mass {batteryMassEstimate(shape).toFixed(3)} kg</span>
              <span>LiPo density 1.70 kg/L</span>
            </div>
          ) : shape.partType === "motor" ? (
            <div className="shape-readout">
              <span>Diameter {(motorDiameter * 1000).toFixed(0)} mm</span>
              <span>Length {(motorLength * 1000).toFixed(0)} mm</span>
              <span>Depth {(motorDepth * 1000).toFixed(0)} mm</span>
              <span>Volume {(motorVolumeM3 * 1000).toFixed(2)} L</span>
              <span>Mass / motor {(motorMassKg / Math.max(motorCount, 1)).toFixed(3)} kg</span>
              <span>Total motor mass {motorMassKg.toFixed(3)} kg</span>
              <span>Motor density 3.20 kg/L</span>
              {cadGeometry?.kind === "cylinder" ? <span>Axis follows motor length</span> : null}
            </div>
          ) : shape.partType === "rotor" ? (
            <>
              <div className="shape-readout">
                <span>Diameter {(rotorDiameterEstimate(shape, mirrorPlanes) * 1000).toFixed(0)} mm</span>
                <span>{rotorInstanceCount(shape, mirrorPlanes)} physical rotors after mirrors</span>
                <span>Blade count {Math.max(1, Math.round(shape.rotorBladeCount ?? 2))} from Sizing</span>
              </div>
              <div className="shape-readout">
                <span>Carbon fibre volume {(rotorVolumePerRotorEstimate(shape, mirrorPlanes) * 1000).toFixed(3)} L / rotor</span>
                <span>Mass / rotor {rotorMassPerRotorEstimate(shape, mirrorPlanes).toFixed(3)} kg</span>
                <span>Carbon fibre density 1.60 kg/L</span>
                <span>Total rotor mass {rotorTotalMassEstimate(shape, mirrorPlanes).toFixed(3)} kg</span>
              </div>
            </>
          ) : (
            <NumberField label="Mass" suffix="kg" value={shape.massKg ?? 0} onChange={(massKg) => onChange({ massKg })} />
          )}
        </>
      )}
      <div className="shape-readout">
        <span>{shape.points.length} points</span>
        {shape.partType === "motor" ? (
          <>
            <span>{motorCount} physical motor{motorCount === 1 ? "" : "s"} after mirror</span>
            <span>{motorLength.toFixed(2)} m axis length</span>
          </>
        ) : (
          <>
            <span>{(bounds.maxX * 2).toFixed(2)} m mirrored width</span>
            <span>{(bounds.maxY - bounds.minY).toFixed(2)} m length</span>
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
