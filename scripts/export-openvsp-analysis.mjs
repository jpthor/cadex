import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectPath = path.resolve(process.argv[2] ?? "aircraft/dartv1/aircraft.json");
const exportDir = path.resolve(process.argv[3] ?? "exports/openvsp");
const aircraft = JSON.parse(readFileSync(projectPath, "utf8"));
const projectName = sanitizeName(aircraft.name ?? aircraft.project?.name ?? "aircraft");
const requestedStage = parseStage(process.argv[4] ?? "full");
const stem = requestedStage === "full" ? `${projectName}_analysis` : `${projectName}_analysis_${requestedStage}`;
const visualStlPath = path.join(exportDir, `${stem}_visual.stl`);
const scriptPath = path.join(exportDir, `${stem}.vspscript`);
const vsp3Path = path.join(exportDir, `${stem}.vsp3`);
const reportPath = path.join(exportDir, `${stem}_report.json`);

mkdirSync(exportDir, { recursive: true });

const allShapes = (aircraft.sizing?.shapes ?? []).filter(
  (shape) => !["referenceLine", "mirrorPlane"].includes(shape.role),
);
const shapes = allShapes.filter((shape) => includeShapeForStage(shape, requestedStage));
const report = [];
const SHOW_ANALYSIS_OBJECTS = true;
const INCLUDE_VISUAL_MESH = false;
const ORIENT_TO_CADEX_TOP_VIEW = true;

function sanitizeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "aircraft";
}

function parseStage(value) {
  const stage = String(value).replace(/^--stage=/, "");
  const allowed = new Set(["fuselage", "wings", "props", "tailboom", "tailplanes", "fins", "full"]);
  return allowed.has(stage) ? stage : "full";
}

function stageRank(stage) {
  return {
    fuselage: 1,
    wings: 2,
    props: 3,
    tailboom: 4,
    tailplanes: 5,
    fins: 6,
    full: 6,
  }[stage] ?? 6;
}

function includeShapeForStage(shape, stage) {
  const rank = stageRank(stage);
  if (shape.role === "body" && /fuselage/i.test(shape.label ?? "")) return rank >= 1;
  if (shape.role === "liftingSurface" && shape.liftingSurfaceKind === "wing") return rank >= 2;
  if (shape.role === "part" && ["motor", "rotor", "battery"].includes(shape.partType ?? "")) return rank >= 3;
  if (shape.role === "body" && /boom|empennage/i.test(shape.label ?? "")) return rank >= 4;
  if (shape.role === "liftingSurface" && shape.liftingSurfaceKind === "tailplane") return rank >= 5;
  if (shape.role === "liftingSurface" && shape.liftingSurfaceKind === "fin") return rank >= 6;
  return stage === "full";
}

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function escapeScript(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sketchToVsp(point) {
  return [number(point.yM), number(point.xM)];
}

function sketchToCanvasVsp(point) {
  return [number(point.yM), number(point.xM)];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function placeX(localX, localY) {
  return ORIENT_TO_CADEX_TOP_VIEW ? localY : localX;
}

function placeY(localX, localY) {
  return ORIENT_TO_CADEX_TOP_VIEW ? localX : localY;
}

function placeZRotation(extra = 0) {
  return ORIENT_TO_CADEX_TOP_VIEW ? 90 + extra : extra;
}

function surfaceX(longitudinal, lateral) {
  return ORIENT_TO_CADEX_TOP_VIEW ? lateral : longitudinal;
}

function surfaceY(longitudinal, lateral) {
  return ORIENT_TO_CADEX_TOP_VIEW ? longitudinal : lateral;
}

function surfaceZRotation(outwardSign) {
  if (!ORIENT_TO_CADEX_TOP_VIEW) return outwardSign > 0 ? 0 : 180;
  return outwardSign > 0 ? -90 : 90;
}

function shownFlagScript() {
  return SHOW_ANALYSIS_OBJECTS ? "" : "    SetSetFlag(gid, 0, false);\n";
}

function cleanPoly(poly) {
  const result = [];
  for (const point of poly) {
    if (!result.length || distance(result[result.length - 1], point) > 1e-5) {
      result.push(point);
    }
  }
  if (result.length > 1 && distance(result[0], result[result.length - 1]) < 1e-5) {
    result.pop();
  }
  return result;
}

function signedArea(poly) {
  let area = 0;
  for (let index = 0; index < poly.length; index += 1) {
    const current = poly[index];
    const next = poly[(index + 1) % poly.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function minAbsX(points) {
  return points.length ? Math.min(...points.map((point) => Math.abs(number(point.xM)))) : Infinity;
}

function maxAbsX(points) {
  return points.length ? Math.max(...points.map((point) => Math.abs(number(point.xM)))) : 0;
}

function touchesCenterline(shape) {
  const points = shape.points ?? [];
  const partType = shape.partType ?? "";
  const tolerance =
    shape.role === "part" && !["motor", "rotor"].includes(partType)
      ? Math.max(0.03, maxAbsX(points) * 0.4)
      : 0.006;
  return minAbsX(points) <= tolerance;
}

function mirrorAcrossY(poly, mirrorY) {
  return cleanPoly(poly.map(([x, y]) => [x, 2 * mirrorY - y]).reverse());
}

function mirroredAcrossCenter(poly) {
  return mirrorAcrossY(poly, 0);
}

function liftingHalfPolygons(shape) {
  const points = shape.points ?? [];
  if (points.length < 3) return [];
  const base = cleanPoly(points.map(sketchToVsp));
  const isTailplane = shape.liftingSurfaceKind === "tailplane";

  if (isTailplane && !touchesCenterline(shape)) {
    const localMirrorY = Math.min(...base.map(([, y]) => y));
    const inner = mirrorAcrossY(base, localMirrorY);
    return [
      { poly: base, name: "outer", rootY: localMirrorY, outwardSign: 1 },
      { poly: inner, name: "inner", rootY: localMirrorY, outwardSign: -1 },
      { poly: mirroredAcrossCenter(base), name: "outer mirror", rootY: -localMirrorY, outwardSign: -1 },
      { poly: mirroredAcrossCenter(inner), name: "inner mirror", rootY: -localMirrorY, outwardSign: 1 },
    ];
  }

  if (touchesCenterline(shape)) {
    const mirrored = [...base]
      .reverse()
      .filter(([, y]) => Math.abs(y) > 1e-5)
      .map(([x, y]) => [x, -y]);
    return [{ poly: cleanPoly([...base, ...mirrored]), name: "center", rootY: 0, outwardSign: 1 }];
  }

  const rootY = minAbsY(base);
  return [
    { poly: base, name: "right", rootY, outwardSign: 1 },
    { poly: mirroredAcrossCenter(base), name: "left", rootY: -rootY, outwardSign: -1 },
  ];
}

function chordAtSpan(poly, spanY) {
  const hits = [];
  const eps = 1e-7;
  for (let index = 0; index < poly.length; index += 1) {
    const a = poly[index];
    const b = poly[(index + 1) % poly.length];
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    if (spanY < minY - eps || spanY > maxY + eps) continue;
    if (Math.abs(a[1] - b[1]) < eps) {
      if (Math.abs(spanY - a[1]) < eps) hits.push(a[0], b[0]);
      continue;
    }
    const t = (spanY - a[1]) / (b[1] - a[1]);
    hits.push(a[0] + (b[0] - a[0]) * t);
  }
  if (hits.length < 2) return null;
  const leading = Math.max(...hits);
  const trailing = Math.min(...hits);
  const chord = leading - trailing;
  if (chord <= 0.01) return null;
  return { y: spanY, leading, trailing, chord };
}

function minAbsY(poly) {
  return poly.reduce((best, [, y]) => (Math.abs(y) < Math.abs(best) ? y : best), poly[0]?.[1] ?? 0);
}

function stationsForHalfPolygon(poly, rootY, outwardSign) {
  const stationSet = chordGuideStationsForHalfPolygon(poly, rootY, outwardSign);
  if (stationSet.length >= 2) return stationSet;

  const ys = [...new Set(poly.map(([, y]) => y))]
    .sort((a, b) => outwardSign * (a - b))
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > 0.01);
  ys.sort((a, b) => Math.abs(a - rootY) - Math.abs(b - rootY));
  const stations = [];
  for (const y of ys) {
    const station = chordAtSpan(poly, y);
    if (station) stations.push(station);
  }
  if (stations.length >= 2) return stations;

  const minY = Math.min(...poly.map(([, y]) => y));
  const maxY = Math.max(...poly.map(([, y]) => y));
  const minX = Math.min(...poly.map(([x]) => x));
  const maxX = Math.max(...poly.map(([x]) => x));
  return [
    { y: rootY, leading: maxX, trailing: minX, chord: Math.max(maxX - minX, 0.03) },
    {
      y: outwardSign > 0 ? maxY : minY,
      leading: maxX,
      trailing: minX,
      chord: Math.max(maxX - minX, 0.03),
    },
  ];
}

function chordGuideStationsForHalfPolygon(poly, rootY, outwardSign) {
  if (poly.length < 3) return [];
  const latitudes = poly.map(([, y]) => y);
  const outerY = outwardSign > 0 ? Math.max(...latitudes) : Math.min(...latitudes);
  const span = outerY - rootY;
  if (Math.abs(span) < 0.02) return [];
  const stationSpecs = [
    { key: "root10", label: "10%", t: 0.1 },
    { key: "tip90", label: "90%", t: 0.9 },
  ];
  const stations = [];
  for (const spec of stationSpecs) {
    const y = rootY + span * spec.t;
    const station = chordAtSpan(poly, y);
    if (!station) return [];
    stations.push({ ...station, stationKey: spec.key, stationLabel: spec.label, stationT: spec.t });
  }
  return stations;
}

function exportReadinessWarnings(shape, halves) {
  const warnings = [];
  if (shape.role === "liftingSurface") {
    for (const half of halves) {
      const guided = chordGuideStationsForHalfPolygon(half.poly, half.rootY, half.outwardSign);
      if (guided.length < 2) {
        warnings.push(`${shape.label ?? "Surface"} ${half.name}: 10%/90% chord stations do not both intersect the outline.`);
      }
    }
  }
  if (shape.role === "body" && touchesCenterline(shape)) {
    const ys = (shape.points ?? []).map((point) => point.yM);
    const noseY = Math.max(...ys);
    const tailY = Math.min(...ys);
    if (!Number.isFinite(noseY) || !Number.isFinite(tailY) || Math.abs(noseY - tailY) < 0.02) {
      warnings.push(`${shape.label ?? "Body"}: nose/tail direction is ambiguous.`);
    }
  }
  if (shape.role === "part" && shape.partType === "rotor" && (shape.points ?? []).length < 2) {
    warnings.push(`${shape.label ?? "Rotor"}: rotor needs center and radius points.`);
  }
  return warnings;
}

function bounds(points) {
  const xs = points.map((point) => Math.abs(number(point.xM)));
  const ys = points.map((point) => number(point.yM));
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function centroid(points) {
  return {
    xM: points.reduce((sum, point) => sum + Math.abs(number(point.xM)), 0) / points.length,
    yM: points.reduce((sum, point) => sum + number(point.yM), 0) / points.length,
  };
}

function setIfValid() {
  return `void SetIfValid(string geom, string parm, string group, double val)
{
    string pid = FindParm(geom, parm, group);
    if (ValidParm(pid)) { SetParmVal(pid, val); }
}

`;
}

function addPodScript(shape) {
  const points = shape.points ?? [];
  if (points.length < 2) return "";
  const b = bounds(points);
  const c = centroid(points);
  const centered = touchesCenterline(shape);
  const length = Math.max(b.maxY - b.minY, 0.02);
  const radius = Math.max(centered ? b.maxX : (b.maxX - b.minX) / 2, 0.01);
  const fineRatio = Math.max(length / radius, 0.1);
  const scripts = [];
  for (const side of centered ? [1] : [1, -1]) {
    const name = `${shape.label ?? "Pod"}${centered ? "" : side < 0 ? " mirror" : ""}`;
    scripts.push(`
    // pod/body/part: ${escapeScript(name)}
    gid = AddGeom("POD", "");
    SetGeomName(gid, "${escapeScript(name)}");
${shownFlagScript()}
    SetIfValid(gid, "Length", "Design", ${length});
    SetIfValid(gid, "FineRatio", "Design", ${fineRatio});
    SetIfValid(gid, "X_Rel_Location", "XForm", ${placeX(c.yM, centered ? 0 : side * c.xM)});
    SetIfValid(gid, "Y_Rel_Location", "XForm", ${placeY(c.yM, centered ? 0 : side * c.xM)});
    SetIfValid(gid, "Z_Rel_Location", "XForm", 0.0);
    SetIfValid(gid, "Z_Rel_Rotation", "XForm", ${placeZRotation(0)});
    Update();
`);
  }
  report.push({ label: shape.label, kind: "pod", count: scripts.length, lengthM: length, radiusM: radius, warnings: exportReadinessWarnings(shape, []) });
  return scripts.join("");
}

function addPropScript(shape) {
  const points = shape.points ?? [];
  if (points.length < 2) return "";
  const center = sketchToVsp(points[0]);
  const end = sketchToVsp(points[1]);
  const radius = Math.max(distance(center, end), 0.02);
  const bladeCount = Math.max(1, Math.round(number(shape.rotorBladeCount, 2)));
  report.push({ label: shape.label, kind: "prop", count: 2, diameterM: radius * 2, bladeCount, warnings: exportReadinessWarnings(shape, []) });
  return [1, -1]
    .map((side) => {
      const name = `${shape.label ?? "Rotor"}${side < 0 ? " mirror" : ""}`;
      return `
    // rotor: ${escapeScript(name)}
    gid = AddGeom("PROP", "");
    SetGeomName(gid, "${escapeScript(name)}");
${shownFlagScript()}
    SetIfValid(gid, "Diameter", "Design", ${radius * 2});
    SetIfValid(gid, "NumBlade", "Design", ${bladeCount});
    SetIfValid(gid, "X_Rel_Location", "XForm", ${placeX(center[0], side * Math.abs(center[1]))});
    SetIfValid(gid, "Y_Rel_Location", "XForm", ${placeY(center[0], side * Math.abs(center[1]))});
    SetIfValid(gid, "Z_Rel_Location", "XForm", 0.0);
    SetIfValid(gid, "Z_Rel_Rotation", "XForm", ${placeZRotation(0)});
    Update();
`;
    })
    .join("");
}

function addWingScript(shape) {
  const scripts = [];
  const halves = liftingHalfPolygons(shape);
  const warnings = exportReadinessWarnings(shape, halves);
  halves.forEach((half) => {
    const { poly, outwardSign } = half;
    const stations = stationsForHalfPolygon(poly, half.rootY, outwardSign);
    if (stations.length < 2) return;
    const name = `${shape.label ?? "Surface"} ${half.name}`;
    const first = stations[0];
    const sectionCount = stations.length - 1;
    const zRotation = surfaceZRotation(outwardSign);
    let script = `
    // lifting surface: ${escapeScript(name)}
    gid = AddGeom("WING", "");
    SetGeomName(gid, "${escapeScript(name)}");
${shownFlagScript()}
    SetIfValid(gid, "Sym_Planar_Flag", "Sym", 0);
`;
    if (sectionCount > 1) {
      for (let index = 0; index < sectionCount; index += 1) {
        script += `    InsertXSec(gid, 1, XS_FOUR_SERIES);\n`;
      }
      script += `    CutXSec(gid, 1);\n    Update();\n`;
    }
    script += `    SetIfValid(gid, "X_Rel_Location", "XForm", ${surfaceX(first.leading, first.y)});
    SetIfValid(gid, "Y_Rel_Location", "XForm", ${surfaceY(first.leading, first.y)});
    SetIfValid(gid, "Z_Rel_Location", "XForm", 0.0);
    SetIfValid(gid, "X_Rel_Rotation", "XForm", 0.0);
    SetIfValid(gid, "Z_Rel_Rotation", "XForm", ${zRotation});
`;
    for (let index = 0; index < sectionCount; index += 1) {
      const a = stations[index];
      const b = stations[index + 1];
      const span = Math.max(Math.abs(b.y - a.y), 0.02);
      const sweep = (Math.atan2(b.leading - a.leading, span) * 180) / Math.PI;
      const twist = number(shape.incidenceDeg, 0);
      script += `    SetDriverGroup(gid, ${index + 1}, SPAN_WSECT_DRIVER, ROOTC_WSECT_DRIVER, TIPC_WSECT_DRIVER);
    SetIfValid(gid, "Span", "XSec_${index + 1}", ${span});
    SetIfValid(gid, "Root_Chord", "XSec_${index + 1}", ${Math.max(a.chord, 0.03)});
    SetIfValid(gid, "Tip_Chord", "XSec_${index + 1}", ${Math.max(b.chord, 0.03)});
    SetIfValid(gid, "Sweep", "XSec_${index + 1}", ${sweep});
    SetIfValid(gid, "Sweep_Location", "XSec_${index + 1}", 0.001);
    SetIfValid(gid, "Dihedral", "XSec_${index + 1}", 0.0);
    SetIfValid(gid, "Twist", "XSec_${index + 1}", ${twist});
    Update();
`;
    }
    scripts.push(script);
    report.push({
      label: shape.label,
      kind: "wing",
      liftingSurfaceKind: shape.liftingSurfaceKind,
      objectName: name,
      outwardSign,
      sections: sectionCount,
      stationSource: stations.every((station) => station.stationKey) ? "10/90 chord guides" : "outline vertices fallback",
      airfoilStations: {
        root10: shape.airfoilStations?.root10 ?? shape.airfoil ?? "NACA 0012",
        tip90: shape.airfoilStations?.tip90 ?? shape.airfoil ?? "NACA 0012",
      },
      incidenceStationsDeg: {
        root10: shape.incidenceStationsDeg?.root10 ?? shape.incidenceDeg ?? 0,
        tip90: shape.incidenceStationsDeg?.tip90 ?? shape.incidenceDeg ?? 0,
      },
      stations,
      warnings,
    });
  });
  return scripts.join("");
}

function tailboomLateralStations() {
  const booms = allShapes.filter((shape) => shape.role === "body" && /boom|empennage/i.test(shape.label ?? ""));
  const stations = booms
    .map((shape) => centroid(shape.points ?? []).xM)
    .filter((value) => Number.isFinite(value) && value > 0.01);
  const station = stations[0] ?? 0.69;
  return [station, -station];
}

function addFinScript(shape) {
  const points = shape.points ?? [];
  if (points.length < 3) return "";
  const warnings = exportReadinessWarnings(shape, liftingHalfPolygons(shape));
  const b = bounds(points);
  const rootChord = Math.max(b.maxY - b.minY, 0.05);
  const tipChord = Math.max(rootChord * 0.55, 0.04);
  const height = Math.max(b.maxX - b.minX, 0.05);
  const longitudinal = (b.minY + b.maxY) / 2;
  const scripts = [];
  tailboomLateralStations().forEach((lateral, index) => {
    const name = `${shape.label ?? "Fin"} ${index + 1}`;
    const localX = longitudinal - rootChord / 2;
    const localY = lateral;
    scripts.push(`
    // vertical fin: ${escapeScript(name)}
    gid = AddGeom("WING", "");
    SetGeomName(gid, "${escapeScript(name)}");
${shownFlagScript()}
    SetIfValid(gid, "Sym_Planar_Flag", "Sym", 0);
    SetIfValid(gid, "X_Rel_Location", "XForm", ${placeX(localX, localY)});
    SetIfValid(gid, "Y_Rel_Location", "XForm", ${placeY(localX, localY)});
    SetIfValid(gid, "Z_Rel_Location", "XForm", 0.0);
    SetIfValid(gid, "Z_Rel_Rotation", "XForm", ${placeZRotation(0)});
    SetDriverGroup(gid, 1, SPAN_WSECT_DRIVER, ROOTC_WSECT_DRIVER, TIPC_WSECT_DRIVER);
    SetIfValid(gid, "Span", "XSec_1", ${height});
    SetIfValid(gid, "Root_Chord", "XSec_1", ${rootChord});
    SetIfValid(gid, "Tip_Chord", "XSec_1", ${tipChord});
    SetIfValid(gid, "Sweep", "XSec_1", 0.0);
    SetIfValid(gid, "Sweep_Location", "XSec_1", 0.25);
    SetIfValid(gid, "Dihedral", "XSec_1", 89.0);
    Update();
`);
    report.push({
      label: shape.label,
      kind: "wing",
      liftingSurfaceKind: "fin",
      objectName: name,
      sections: 1,
      lateralM: lateral,
      heightM: height,
      rootChordM: rootChord,
      tipChordM: tipChord,
      warnings,
    });
  });
  return scripts.join("");
}

function writeVisualStl() {
  const visualVerts = [];
  const visualFaces = [];
  const addVertex = (point) => {
    visualVerts.push(point);
    return visualVerts.length - 1;
  };
  const addFace = (a, b, c) => visualFaces.push([a, b, c]);
  const visualClean = (poly) => cleanPoly(poly);
  const visualPolygons = (shape) => {
    const points = shape.points ?? [];
    if (points.length < 3) return [];
    const base = visualClean(points.map(sketchToCanvasVsp));
    const isTailplane = shape.role === "liftingSurface" && shape.liftingSurfaceKind === "tailplane";
    if (isTailplane && !touchesCenterline(shape)) {
      const localMirrorX = Math.min(...base.map(([x]) => x));
      const local = visualClean([
        ...base,
        ...[...base]
          .reverse()
          .filter(([x]) => Math.abs(x - localMirrorX) > 1e-5)
          .map(([x, y]) => [2 * localMirrorX - x, y]),
      ]);
      return [local, visualClean(local.map(([x, y]) => [-x, y]).reverse())];
    }
    if (touchesCenterline(shape)) {
      const mirrored = [...base]
        .reverse()
        .filter(([x]) => Math.abs(x) > 1e-5)
        .map(([x, y]) => [-x, y]);
      return [visualClean([...base, ...mirrored])];
    }
    return [base, visualClean(base.map(([x, y]) => [-x, y]).reverse())];
  };
  const visualArea = (poly) => signedArea(poly);
  const extrude = (poly, zTop, zBottom) => {
    let clean = visualClean(poly);
    if (clean.length < 3 || Math.abs(visualArea(clean)) < 1e-6) return;
    if (visualArea(clean) < 0) clean = [...clean].reverse();
    const top = clean.map(([x, y]) => addVertex([x, y, zTop]));
    const bottom = clean.map(([x, y]) => addVertex([x, y, zBottom]));
    for (let index = 1; index < clean.length - 1; index += 1) {
      addFace(top[0], top[index], top[index + 1]);
      addFace(bottom[0], bottom[index + 1], bottom[index]);
    }
    for (let index = 0; index < clean.length; index += 1) {
      const next = (index + 1) % clean.length;
      addFace(top[index], bottom[index], bottom[next]);
      addFace(top[index], bottom[next], top[next]);
    }
  };
  const segmentBox = (a, b, width, zTop, zBottom) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * (width / 2);
    const ny = (dx / length) * (width / 2);
    extrude(
      [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ],
      zTop,
      zBottom,
    );
  };
  const rotor = (center, radius, bladeCount, chord) => {
    for (let index = 0; index < bladeCount; index += 1) {
      const angle = (Math.PI * 2 * index) / bladeCount;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const root = radius * 0.12;
      segmentBox(
        [center[0] + dx * root, center[1] + dy * root],
        [center[0] + dx * radius, center[1] + dy * radius],
        chord,
        0.018,
        -0.018,
      );
      segmentBox(
        [center[0] - dx * root, center[1] - dy * root],
        [center[0] - dx * radius, center[1] - dy * radius],
        chord,
        0.018,
        -0.018,
      );
    }
  };

  for (const shape of shapes) {
    const points = shape.points ?? [];
    if (shape.role === "part" && shape.partType === "rotor" && points.length >= 2) {
      const center = sketchToCanvasVsp(points[0]);
      const end = sketchToCanvasVsp(points[1]);
      const radius = distance(center, end);
      const bladeCount = Math.max(1, Math.round(number(shape.rotorBladeCount, 2)));
      rotor(center, radius, bladeCount, Math.max(radius * 0.05, 0.012));
      rotor([-center[0], center[1]], radius, bladeCount, Math.max(radius * 0.05, 0.012));
      continue;
    }
    if (shape.role === "part" && shape.partType === "motor" && points.length >= 2) {
      const start = sketchToCanvasVsp(points[0]);
      const end = sketchToCanvasVsp(points[1]);
      const width = Math.max(distance(start, end) * 1.2, 0.035);
      segmentBox(start, end, width, 0.035, -0.035);
      segmentBox([-start[0], start[1]], [-end[0], end[1]], width, 0.035, -0.035);
      continue;
    }
    const polygons = visualPolygons(shape);
    const thickness = shape.role === "liftingSurface" ? 0.018 : shape.role === "body" ? 0.06 : 0.04;
    for (const poly of polygons) extrude(poly, thickness / 2, -thickness / 2);
  }

  const faceNormal = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...normal) || 1;
    return normal.map((value) => value / length);
  };
  let stl = `solid ${stem}_visual\n`;
  for (const face of visualFaces) {
    const a = visualVerts[face[0]];
    const b = visualVerts[face[1]];
    const c = visualVerts[face[2]];
    const normal = faceNormal(a, b, c);
    stl += `facet normal ${normal[0]} ${normal[1]} ${normal[2]}\nouter loop\n`;
    stl += `vertex ${a[0]} ${a[1]} ${a[2]}\nvertex ${b[0]} ${b[1]} ${b[2]}\nvertex ${c[0]} ${c[1]} ${c[2]}\n`;
    stl += "endloop\nendfacet\n";
  }
  stl += `endsolid ${stem}_visual\n`;
  writeFileSync(visualStlPath, stl);
  return { vertices: visualVerts.length, triangles: visualFaces.length };
}

const visualMesh = INCLUDE_VISUAL_MESH ? writeVisualStl() : null;

let script = `${setIfValid()}void main()
{
    ClearVSPModel();
    string gid;
`;

if (INCLUDE_VISUAL_MESH) {
  script += `
    gid = ImportFile("${escapeScript(visualStlPath)}", IMPORT_STL, "");
    SetGeomName(gid, "${escapeScript(projectName)} sketch visual");
    Update();
`;
}

for (const shape of shapes) {
  if (shape.role === "liftingSurface") continue;
  if (shape.role === "part" && shape.partType === "rotor") {
    script += addPropScript(shape);
  } else {
    script += addPodScript(shape);
  }
}
for (const shape of shapes.filter((shape) => shape.role === "liftingSurface")) {
  script += shape.liftingSurfaceKind === "fin" ? addFinScript(shape) : addWingScript(shape);
}

script += `
    Update();
    string vehicle = FindContainer("Vehicle", 0);
    SetParmVal( FindParm(vehicle, "RotationZ", "AdjustView"), 0.0 );
    SetParmVal( FindParm(vehicle, "Zoom", "AdjustView"), 0.6 );
    Update();
    WriteVSPFile("${escapeScript(vsp3Path)}", SET_ALL);
}
`;

writeFileSync(scriptPath, script);

const vspBinary = findOpenVspBinary();
let openvsp = { attempted: false, ok: false, stdout: "", stderr: "" };
if (vspBinary) {
  const result = spawnSync(vspBinary, ["-script", scriptPath], { encoding: "utf8" });
  openvsp = {
    attempted: true,
    ok: result.status === 0 || exists(vsp3Path),
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const output = {
  projectPath,
  visualStlPath,
  scriptPath,
  vsp3Path,
  visualMesh,
  objects: report,
  openvsp,
};
writeFileSync(reportPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));

function exists(filePath) {
  try {
    readFileSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function findOpenVspBinary() {
  const candidates = ["/Applications/OpenVSP.app/Contents/Resources/vsp", "vsp", "openvsp"];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-help"], { encoding: "utf8" });
    if (!result.error) return candidate;
  }
  return null;
}
