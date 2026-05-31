import type { PartType, SizeShape, SizingAnalysis } from "../sizing";
import { effectiveTailVolumeCoefficient, liftingSurfaceStats, shapeBounds, tailplaneAuthorityFactor } from "../sizing/auditedSizingEngine";
import { mirrorAxisTouchToleranceM } from "./constants";
import { chordExtentsAtX, mirrorPointsAcrossPlane, shapeTouchesMirrorAxis, shapeTouchesMirrorPlane } from "./geometry";

export type AircraftDiagnostic = {
  level: "ok" | "warn" | "bad";
  label: string;
  value: string;
  message: string;
};
export function analyseAircraftSizing(
  shapes: SizeShape[],
  analysis: SizingAnalysis,
  partCounts: Record<PartType, number>,
  tailplaneSize: ReturnType<typeof computeTailplaneSize>,
): AircraftDiagnostic[] {
  const wingShapes = shapes.filter((shape) => shape.role === "liftingSurface" && isWingLikeKind(shape.liftingSurfaceKind));
  const tailShapes = shapes.filter((shape) => shape.role === "liftingSurface" && shape.liftingSurfaceKind === "tailplane");
  const wingSpanM = Math.max(...wingShapes.map((shape) => effectiveMirroredSpan(shape, shapes)), 0);
  const wingAreaM2 = analysis.wingAreaM2;
  const meanChordM = analysis.meanChordM;
  const wingLoadingKgM2 = analysis.totalMassKg / Math.max(wingAreaM2, 0.001);
  const tailAreaRatio = tailplaneSize.areaM2 / Math.max(wingAreaM2, 0.001);
  const wingAcYM = weightedAerodynamicCenterY(wingShapes, shapes);
  const tailAcYM = weightedAerodynamicCenterY(tailShapes, shapes);
  const tailArmM = wingAcYM !== undefined && tailAcYM !== undefined ? wingAcYM - tailAcYM : 0;
  const rawTailVolume = tailArmM > 0 ? (tailplaneSize.areaM2 * tailArmM) / Math.max(wingAreaM2 * meanChordM, 0.001) : 0;
  const tailVolume = effectiveTailVolumeCoefficient(rawTailVolume);
  const diagnostics: AircraftDiagnostic[] = [];

  diagnostics.push({
    level: wingAreaM2 <= 0.001 ? "bad" : wingLoadingKgM2 > 22 ? "bad" : wingLoadingKgM2 > 16 ? "warn" : "ok",
    label: "Wing loading",
    value: `${wingLoadingKgM2.toFixed(1)} kg/m2`,
    message:
      wingLoadingKgM2 > 22
        ? "High for a small electric aircraft. Expect faster stall and takeoff; add wing area or reduce mass."
        : wingLoadingKgM2 > 16
          ? "Moderate-high. This can work for cruise, but check stall speed and launch margin."
          : "Looks reasonable for an early electric aircraft sizing sketch.",
  });

  diagnostics.push({
    level: analysis.staticMarginPct < 5 ? "bad" : analysis.staticMarginPct > 20 ? "warn" : "ok",
    label: "Static margin",
    value: `${analysis.staticMarginPct.toFixed(1)}%`,
    message:
      analysis.staticMarginPct < 5
        ? "CoM is too close to or behind CoP. Move mass forward, move the wing back, or increase aft tail authority."
        : analysis.staticMarginPct > 20
          ? "Likely very stable but pitch-heavy. You may be carrying more tail authority or nose mass than needed."
          : "CoM and CoP separation is in a normal first-pass range.",
  });

  diagnostics.push({
    level: tailAreaRatio < 0.1 ? "warn" : tailAreaRatio > 0.28 ? "warn" : "ok",
    label: "Tailplane area",
    value: `${(tailAreaRatio * 100).toFixed(1)}% of wing`,
    message:
      tailAreaRatio < 0.1
        ? "Small tailplane area. It may still work with a long tail arm, but pitch authority could be tight."
        : tailAreaRatio > 0.28
          ? "Large tailplane area. This may add drag and mass unless you need strong pitch authority."
          : "Tailplane area is in a plausible range for a conventional layout.",
  });

  diagnostics.push({
    level: !tailplaneSize.count ? "bad" : tailVolume < 0.35 ? "warn" : tailVolume > 0.9 ? "warn" : "ok",
    label: "Effective tail volume",
    value: tailplaneSize.count ? `${tailVolume.toFixed(2)} (${rawTailVolume.toFixed(2)} raw)` : "missing",
    message:
      !tailplaneSize.count
        ? "No tailplane is marked, so pitch stability cannot be judged properly."
        : tailVolume < 0.35
          ? "Low tail volume. Increase tail area, tail span, or tail arm."
        : tailVolume > 0.9
            ? "High effective tail volume. Stable, but possibly oversized once rotor wake and all-moving authority are included."
            : `Tail volume includes a ${tailplaneAuthorityFactor().toFixed(2)}x rotor-wake/all-moving authority factor.`,
  });

  diagnostics.push({
    level: partCounts.rotor && partCounts.motor && partCounts.rotor !== partCounts.motor ? "warn" : "ok",
    label: "Propulsors",
    value: `${partCounts.motor} motors / ${partCounts.rotor} rotors`,
    message:
      partCounts.rotor && partCounts.motor && partCounts.rotor !== partCounts.motor
        ? "Rotor and motor counts do not match. Check mirrored motors/rotors and local mirror planes."
        : "Motor and rotor counts are consistent.",
  });

  if (!wingShapes.length) {
    diagnostics.unshift({
      level: "bad",
      label: "Wing",
      value: "missing",
      message: "Mark at least one lifting surface as Wing so reference area and stability use the right surface.",
    });
  } else if (wingSpanM > 0) {
    diagnostics.push({
      level: wingSpanM / Math.max(meanChordM, 0.001) < 5 ? "warn" : "ok",
      label: "Aspect ratio",
      value: (wingSpanM / Math.max(meanChordM, 0.001)).toFixed(1),
      message:
        wingSpanM / Math.max(meanChordM, 0.001) < 5
          ? "Low aspect ratio for cruise efficiency. A longer span or smaller chord may improve endurance."
          : "Aspect ratio is reasonable for a quick cruise-oriented sketch.",
    });
  }

  diagnostics.push(...analyseSketchExportReadiness(shapes));

  return diagnostics;
}

function isWingLikeKind(kind: SizeShape["liftingSurfaceKind"]) {
  return (kind ?? "wing") === "wing" || kind === "wingevon";
}

export function analyseSketchExportReadiness(shapes: SizeShape[]): AircraftDiagnostic[] {
  const diagnostics: AircraftDiagnostic[] = [];
  const liftingSurfaces = shapes.filter((shape) => shape.role === "liftingSurface");
  const bodies = shapes.filter((shape) => shape.role === "body");
  const rotors = shapes.filter((shape) => shape.role === "part" && shape.partType === "rotor");

  for (const shape of liftingSurfaces) {
    const bounds = shapeBounds(shape);
    const spanM = bounds.maxX - bounds.minX;
    const stationChecks = [
      { label: "Root", xM: bounds.minX },
      { label: "Tip", xM: bounds.maxX },
    ];
    const missingStation = stationChecks.find((station) => !chordExtentsAtX(shape.points, station.xM));
    diagnostics.push({
      level: spanM < 0.02 || missingStation ? "bad" : "ok",
      label: `${shape.label} export stations`,
      value: missingStation ? `${missingStation.label} missing` : "Root / Tip",
      message: missingStation
        ? "A chord station does not cut the lifting surface cleanly. Adjust the outline so both station lines cross the surface."
        : "OpenVSP export can use the root and tip chord lines as stations.",
    });
  }

  for (const shape of bodies) {
    const bounds = shapeBounds(shape);
    diagnostics.push({
      level: bounds.maxY <= bounds.minY + 0.02 ? "bad" : "ok",
      label: `${shape.label} body axis`,
      value: `${Math.abs(bounds.maxY - bounds.minY).toFixed(2)} m`,
      message:
        bounds.maxY <= bounds.minY + 0.02
          ? "Body has no clear nose-to-tail axis. Draw it with a clear length along X."
          : "Body has a clear nose-to-tail direction for export.",
    });
  }

  for (const shape of rotors) {
    diagnostics.push({
      level: shape.points.length >= 2 ? "ok" : "bad",
      label: `${shape.label} rotor`,
      value: shape.points.length >= 2 ? "center + radius" : "incomplete",
      message:
        shape.points.length >= 2
          ? "Rotor has a center and radius point, so diameter and placement are explicit."
          : "Rotor needs a center point and a radius point.",
    });
  }

  return diagnostics;
}

export function weightedAerodynamicCenterY(shapes: SizeShape[], allShapes: SizeShape[]) {
  let areaSum = 0;
  let momentSum = 0;
  for (const shape of shapes) {
    const stats = liftingSurfaceStats(shape, allShapes);
    const area = stats.areaM2 * diagnosticSurfaceInstanceMultiplier(shape, allShapes);
    if (area <= 0) continue;
    areaSum += area;
    momentSum += stats.aerodynamicCenterY * area;
  }
  return areaSum > 0 ? momentSum / areaSum : undefined;
}

export function computeTailplaneSize(shapes: SizeShape[]) {
  return shapes.reduce(
    (totals, shape) => {
      if (shape.role !== "liftingSurface" || shape.liftingSurfaceKind !== "tailplane") return totals;
      const stats = liftingSurfaceStats(shape, shapes);
      const multiplier = diagnosticSurfaceInstanceMultiplier(shape, shapes);
      const bounds = shapeBounds(shape);
      const localSpanM = Math.max(bounds.maxX - bounds.minX, 0);
      return {
        count: totals.count + multiplier,
        areaM2: totals.areaM2 + stats.areaM2,
        spanM: Math.max(totals.spanM, localSpanM || stats.spanM),
      };
    },
    { count: 0, areaM2: 0, spanM: 0 },
  );
}

export function diagnosticSurfaceInstanceMultiplier(shape: SizeShape, shapes: SizeShape[]) {
  if (shape.liftingSurfaceKind !== "tailplane") return 1;
  void shapes;
  return shapeTouchesMirrorAxis(shape) ? 1 : 2;
}

export function effectiveMirroredSpan(shape: SizeShape, shapes: SizeShape[]) {
  const localMirrorPlane = shapes.find((candidate) => candidate.role === "mirrorPlane" && shapeTouchesMirrorPlane(shape, candidate));
  const points = localMirrorPlane ? [...shape.points, ...mirrorPointsAcrossPlane(shape.points, localMirrorPlane)] : shape.points;
  return shapeBounds({ ...shape, points }).maxX * 2;
}

export function countParts(shapes: SizeShape[]): Record<PartType, number> {
  return shapes.reduce<Record<PartType, number>>(
    (counts, shape) => {
      if (shape.role === "part") {
        counts[shape.partType ?? "payload"] += mirroredInstanceCount(shape);
      }
      return counts;
    },
    { payload: 0, battery: 0, motor: 0, rotor: 0, electronics: 0 },
  );
}

export function mirroredInstanceCount(shape: SizeShape) {
  return partTouchesMirrorAxis(shape) ? 1 : 2;
}

export function partTouchesMirrorAxis(shape: SizeShape) {
  return shape.points.some((point) => Math.abs(point.xM) <= mirrorAxisTouchToleranceM);
}
