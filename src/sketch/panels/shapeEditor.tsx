import { Trash2 } from "lucide-react";
import {
  bodyMaterialLabels,
  liftingSurfaceKindLabels,
  partTypeLabels,
  roleLabels,
} from "../../sizing";
import type {
  BodyMaterial,
  LiftingSurfaceKind,
  PartType,
  SizeShape,
  SizeShapeRole,
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
  inferredMotorDepthM,
  liftingSurfaceMassEstimate,
  liftingSurfaceSkinAreaEstimate,
  motorMassEstimate,
  motorPlanformAreaEstimate,
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
  return (
    <div className="component-editor">
      <label className="sizing-field">
        <span>Label</span>
        <input value={shape.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>
      <div className="segmented-control sizing-role-control" aria-label="Selected shape type">
        <button
          className={shape.role === "body" ? "active" : ""}
          onClick={() => onChange({ role: "body", airfoil: undefined, liftingSurfaceKind: undefined, airfoilStations: undefined, partType: undefined })}
        >
          Body
        </button>
        <button
          className={shape.role === "liftingSurface" ? "active" : ""}
          onClick={() =>
            onChange({
              role: "liftingSurface",
              airfoil: shape.airfoil ?? "NACA 0012",
              liftingSurfaceKind: shape.liftingSurfaceKind ?? "wing",
              airfoilStations: shape.airfoilStations ?? { root10: shape.airfoil ?? "NACA 0012", tip90: shape.airfoil ?? "NACA 0012" },
              incidenceDeg: shape.incidenceDeg ?? 0,
              incidenceStationsDeg: shape.incidenceStationsDeg ?? {
                root10: shape.incidenceDeg ?? 0,
                tip90: shape.incidenceDeg ?? 0,
              },
              bodyMaterial: shape.bodyMaterial ?? "carbonFibre",
              bodyThicknessMm: shape.bodyThicknessMm ?? 1.2,
              partType: undefined,
            })
          }
        >
          Lifting surface
        </button>
        <button
          className={`part-role-button ${shape.role === "part" ? "active" : ""}`}
          onClick={() =>
            onChange({
              role: "part",
              airfoil: undefined,
              liftingSurfaceKind: undefined,
              airfoilStations: undefined,
              incidenceDeg: undefined,
              incidenceStationsDeg: undefined,
              partType: shape.partType ?? "payload",
              massKg: shape.massKg ?? 0,
            })
          }
        >
          Part
        </button>
      </div>
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
            <span>Planform skin area {liftingSurfaceSkinAreaEstimate(shape).toFixed(3)} m2</span>
            <span>Surface mass {liftingSurfaceMassEstimate(shape).toFixed(3)} kg</span>
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
          <label className="sizing-field">
            <span>Part</span>
            <select value={shape.partType ?? "payload"} onChange={(event) => onChange({ partType: event.target.value as PartType })}>
              {Object.entries(partTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
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
              <span>Plan area {motorPlanformAreaEstimate(shape).toFixed(4)} m2</span>
              <span>Inferred depth {(inferredMotorDepthM(shape) * 1000).toFixed(0)} mm</span>
              <span>Volume {(motorVolumeEstimate(shape) * 1000).toFixed(2)} L</span>
              <span>Motor mass {motorMassEstimate(shape).toFixed(3)} kg</span>
              <span>Motor density 3.20 kg/L</span>
            </div>
          ) : shape.partType === "rotor" ? (
            <>
              <div className="shape-readout">
                <span>Diameter {rotorDiameterEstimate(shape, mirrorPlanes).toFixed(3)} m</span>
                <span>{rotorInstanceCount(shape, mirrorPlanes)} physical rotors after mirrors</span>
              </div>
              <NumberField
                label="Blade count"
                suffix=""
                value={shape.rotorBladeCount ?? 2}
                step={1}
                onChange={(rotorBladeCount) => onChange({ rotorBladeCount: Math.max(1, Math.round(rotorBladeCount)) })}
              />
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
        <span>{(bounds.maxX * 2).toFixed(2)} m mirrored width</span>
        <span>{(bounds.maxY - bounds.minY).toFixed(2)} m length</span>
      </div>
      <button className="delete-component-button" onClick={onDelete}>
        <Trash2 size={15} />
        Delete shape
      </button>
    </div>
  );
}
