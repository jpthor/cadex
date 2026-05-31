import { Gauge, Plane, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { computeSizingAnalysis } from "../../sizing";
import type { SizeShape, SizingProject } from "../../sizing";
import { Sketch3DPreview } from "../../sketch/canvas/Sketch3DPreview";

type FlightInputs = {
  pitch: number;
  roll: number;
  yaw: number;
  flap: number;
};

type SurfaceMix = {
  flap: number;
  pitch: number;
  roll: number;
  surfaceId: string;
  yaw: number;
};

const defaultInputs: FlightInputs = {
  pitch: 0,
  roll: 0,
  yaw: 0,
  flap: 0,
};

export function FlightDashboard({
  project,
  onProjectChange,
}: {
  project: SizingProject;
  onProjectChange: (next: SizingProject) => void;
}) {
  const analysis = useMemo(() => (project.shapes.length ? computeSizingAnalysis(project) : project.analysis), [project]);
  const movingSurfaces = useMemo(() => project.shapes.filter((shape) => isProgrammableSurface(shape)), [project.shapes]);
  const [inputs, setInputs] = useState<FlightInputs>(defaultInputs);
  const [mixes, setMixes] = useState<SurfaceMix[]>(() => movingSurfaces.map(defaultMixForSurface));
  const normalizedMixes = useMemo(() => {
    const existing = new Map(mixes.map((mix) => [mix.surfaceId, mix]));
    return movingSurfaces.map((surface) => existing.get(surface.id) ?? defaultMixForSurface(surface));
  }, [mixes, movingSurfaces]);
  const mixBySurfaceId = useMemo(() => new Map(normalizedMixes.map((mix) => [mix.surfaceId, mix])), [normalizedMixes]);
  const previewShapes = useMemo(
    () =>
      project.shapes.map((shape) => {
        if (!isProgrammableSurface(shape)) return shape;
        const mix = mixBySurfaceId.get(shape.id);
        if (!mix || !shape.movement) return shape;
        const deflectionDeg = mixedDeflection(shape, mix, inputs);
        return {
          ...shape,
          movement: {
            ...shape.movement,
            enabled: true,
            deflectionDeg,
          },
        };
      }),
    [inputs, mixBySurfaceId, project.shapes],
  );

  function patchInput(key: keyof FlightInputs, value: number) {
    setInputs((current) => ({ ...current, [key]: clamp(value, -1, 1) }));
  }

  function patchMix(surfaceId: string, patch: Partial<SurfaceMix>) {
    setMixes((current) => {
      const currentById = new Map(normalizedMixes.map((mix) => [mix.surfaceId, mix]));
      const existing = currentById.get(surfaceId);
      if (!existing) return current;
      currentById.set(surfaceId, { ...existing, ...patch });
      return Array.from(currentById.values());
    });
  }

  function renameSurface(surfaceId: string, label: string) {
    onProjectChange({
      ...project,
      shapes: project.shapes.map((shape) => (shape.id === surfaceId ? { ...shape, label } : shape)),
      analysis: undefined,
    });
  }

  function applyPoseToSketch() {
    onProjectChange({
      ...project,
      shapes: project.shapes.map((shape) => {
        if (!isProgrammableSurface(shape) || !shape.movement) return shape;
        const mix = mixBySurfaceId.get(shape.id);
        if (!mix) return shape;
        return {
          ...shape,
          movement: {
            ...shape.movement,
            deflectionDeg: mixedDeflection(shape, mix, inputs),
          },
        };
      }),
      analysis: undefined,
    });
  }

  return (
    <main className="flight-dashboard">
      <section className="flight-view-panel">
        <div className="flight-view-toolbar">
          <div>
            <span>Flight MVP</span>
            <strong>Sketch control mixer</strong>
          </div>
          <button className="compute-button flight-apply-button" onClick={applyPoseToSketch} type="button">
            Apply pose to Sketch
          </button>
        </div>
        <Sketch3DPreview
          active
          cameraCommandSerial={0}
          onOrbitStart={() => undefined}
          selectedShapeId=""
          shapes={previewShapes}
          showGuides
          viewMode="top"
        />
      </section>

      <aside className="flight-side-panel">
        <div className="compute-panel-heading">
          <Gauge size={17} />
          <h3>Pilot inputs</h3>
        </div>
        <InputSlider label="Pitch" value={inputs.pitch} onChange={(value) => patchInput("pitch", value)} />
        <InputSlider label="Roll" value={inputs.roll} onChange={(value) => patchInput("roll", value)} />
        <InputSlider label="Yaw" value={inputs.yaw} onChange={(value) => patchInput("yaw", value)} />
        <InputSlider label="Flap" value={inputs.flap} onChange={(value) => patchInput("flap", value)} />
        <button className="flight-reset-button" onClick={() => setInputs(defaultInputs)} type="button">
          Center inputs
        </button>
        <div className="flight-readouts">
          <Readout label="Mass" value={`${(analysis?.totalMassKg ?? 0).toFixed(2)} kg`} />
          <Readout label="Static margin" value={`${(analysis?.staticMarginPct ?? 0).toFixed(1)}%`} />
          <Readout label="Moving surfaces" value={String(movingSurfaces.length)} />
        </div>
      </aside>

      <section className="flight-mixer-panel">
        <div className="compute-panel-heading">
          <SlidersHorizontal size={17} />
          <h3>Surface mixer</h3>
        </div>
        {movingSurfaces.length ? (
          <div className="flight-mixer-table">
            <div className="flight-mixer-head">
              <span>Surface</span>
              <span>Pitch</span>
              <span>Roll</span>
              <span>Yaw</span>
              <span>Flap</span>
              <span>Pose</span>
            </div>
            {movingSurfaces.map((surface) => {
              const mix = mixBySurfaceId.get(surface.id) ?? defaultMixForSurface(surface);
              return (
                <div className="flight-mixer-row" key={surface.id}>
                  <label className="flight-surface-name">
                    <Plane size={14} />
                    <input value={surface.label} onChange={(event) => renameSurface(surface.id, event.target.value)} />
                  </label>
                  <MixerNumber value={mix.pitch} onChange={(pitch) => patchMix(surface.id, { pitch })} />
                  <MixerNumber value={mix.roll} onChange={(roll) => patchMix(surface.id, { roll })} />
                  <MixerNumber value={mix.yaw} onChange={(yaw) => patchMix(surface.id, { yaw })} />
                  <MixerNumber value={mix.flap} onChange={(flap) => patchMix(surface.id, { flap })} />
                  <strong>{formatSigned(mixedDeflection(surface, mix, inputs))} deg</strong>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="compute-empty flight-empty">
            <h2>No moving surfaces yet</h2>
            <p>In Sketch, select a surface, open Movement, enable a hinge, then return here to program it.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function InputSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flight-input-slider">
      <span>
        <strong>{label}</strong>
        <b>{formatSigned(value * 100)}%</b>
      </span>
      <input
        max={1}
        min={-1}
        step={0.01}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function MixerNumber({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <input
      className="flight-mix-number"
      max={1}
      min={-1}
      step={0.05}
      type="number"
      value={value}
      onChange={(event) => onChange(clamp(Number(event.target.value), -1, 1))}
    />
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="compute-metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isProgrammableSurface(shape: SizeShape) {
  return Boolean(shape.movement?.enabled && shape.movement.hingeLineId);
}

function defaultMixForSurface(surface: SizeShape): SurfaceMix {
  const label = surface.label.toLowerCase();
  const pitch = label.includes("elevator") || label.includes("tail") ? 1 : 0;
  const yaw = label.includes("rudder") || label.includes("fin") ? 1 : 0;
  const flap = label.includes("flap") ? 1 : 0;
  const roll = label.includes("aileron") || label.includes("wingevon") ? (surfaceCenterX(surface) < 0 ? -1 : 1) : 0;
  return { flap, pitch, roll, surfaceId: surface.id, yaw };
}

function mixedDeflection(surface: SizeShape, mix: SurfaceMix, inputs: FlightInputs) {
  const movement = surface.movement;
  if (!movement) return 0;
  const throwDeg = Math.max(Math.abs(movement.minDeg), Math.abs(movement.maxDeg), 1);
  const command =
    inputs.pitch * mix.pitch +
    inputs.roll * mix.roll +
    inputs.yaw * mix.yaw +
    inputs.flap * mix.flap;
  const requested = movement.neutralDeg + clamp(command, -1, 1) * throwDeg;
  return clamp(requested, Math.min(movement.minDeg, movement.maxDeg), Math.max(movement.minDeg, movement.maxDeg));
}

function surfaceCenterX(surface: SizeShape) {
  if (!surface.points.length) return 0;
  return surface.points.reduce((sum, point) => sum + point.xM, 0) / surface.points.length;
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)}`;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, min), max);
}
