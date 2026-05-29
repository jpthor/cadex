#!/usr/bin/env python3
import json
import math
import sys

import machupX as MX


def convert(value):
    try:
        import numpy as np
        if isinstance(value, np.ndarray):
            return value.tolist()
        if hasattr(value, "item"):
            return value.item()
    except Exception:
        pass
    raise TypeError(type(value).__name__)


def solve_alpha(scene_path, alpha_deg):
    scene = json.load(open(scene_path))
    plane = scene["scene"]["aircraft"]["cadex"]
    plane["state"]["alpha"] = alpha_deg
    mx_scene = MX.Scene(scene)
    result = mx_scene.solve_forces(dimensional=False, non_dimensional=True, verbose=False)
    total = result["cadex"]["total"]
    return {
        "alphaDeg": alpha_deg,
        "CL": float(total["CL"]),
        "CD": float(total["CD"]),
        "Cm": float(total["Cm"]),
        "raw": result,
    }


def solve_full(scene_path, alpha_deg):
    scene = json.load(open(scene_path))
    plane = scene["scene"]["aircraft"]["cadex"]
    plane["state"]["alpha"] = alpha_deg
    mx_scene = MX.Scene(scene)

    outputs = {}
    force_result = safe_call(lambda: mx_scene.solve_forces(
        dimensional=True,
        non_dimensional=True,
        report_by_segment=True,
        verbose=False,
    ))
    outputs["forces"] = summarize_forces(force_result)
    outputs["aeroCenter"] = safe_call(lambda: mx_scene.aero_center())
    outputs["stabilityDerivatives"] = safe_call(lambda: mx_scene.stability_derivatives())
    outputs["dampingDerivatives"] = safe_call(lambda: mx_scene.damping_derivatives())
    outputs["allDerivatives"] = safe_call(lambda: mx_scene.derivatives())
    outputs["spanwise"] = summarize_distributions(safe_call(lambda: mx_scene.distributions()))
    outputs["pitchTrim"] = safe_call(lambda: mx_scene.pitch_trim())
    return outputs


def safe_call(fn):
    try:
        return {"ok": True, "value": fn()}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


def summarize_forces(result):
    if not result.get("ok"):
        return result
    aircraft = result["value"].get("cadex", {})
    total = aircraft.get("total", {})
    inviscid = aircraft.get("inviscid", {})
    viscous = aircraft.get("viscous", {})
    segments = []
    for source in (inviscid, viscous, total):
        cl_map = source.get("CL") or source.get("Cz") or {}
        if isinstance(cl_map, dict):
            for name, value in cl_map.items():
                if name != "total" and not any(segment["name"] == name for segment in segments):
                    segments.append({"name": name})
    for segment in segments:
        name = segment["name"]
        segment["CL"] = coefficient_at(total, "CL", name)
        segment["CD"] = coefficient_at(total, "CD", name)
        segment["Cm"] = coefficient_at(total, "Cm", name)
    return {
        "ok": True,
        "total": {
            "CL": coefficient_at(total, "CL", "total"),
            "CD": coefficient_at(total, "CD", "total"),
            "Cm": coefficient_at(total, "Cm", "total"),
            "Cl": coefficient_at(total, "Cl", "total"),
            "Cn": coefficient_at(total, "Cn", "total"),
        },
        "segments": segments,
    }


def coefficient_at(source, key, name):
    values = source.get(key)
    if isinstance(values, dict) and name in values:
        return float(values[name])
    if name == "total" and values is not None:
        return float(values)
    return None


def summarize_distributions(result):
    if not result.get("ok"):
        return result
    aircraft = result["value"].get("cadex", {})
    surfaces = []
    all_section_cl = []
    all_re = []
    for name, values in aircraft.items():
        section_cl = floats(values.get("section_CL", []))
        chord = floats(values.get("chord", []))
        re = floats(values.get("Re", []))
        alpha = floats(values.get("alpha", []))
        if section_cl:
            all_section_cl.extend(section_cl)
        if re:
            all_re.extend(re)
        surfaces.append({
            "name": name,
            "stations": len(section_cl) or len(chord) or len(re),
            "maxSectionCL": max(section_cl) if section_cl else None,
            "minSectionCL": min(section_cl) if section_cl else None,
            "meanSectionCL": mean(section_cl),
            "maxRe": max(re) if re else None,
            "meanAlphaDeg": mean(alpha) * 180 / math.pi if alpha else None,
        })
    return {
        "ok": True,
        "surfaceCount": len(surfaces),
        "surfaces": surfaces,
        "maxSectionCL": max(all_section_cl) if all_section_cl else None,
        "minSectionCL": min(all_section_cl) if all_section_cl else None,
        "meanSectionCL": mean(all_section_cl),
        "maxRe": max(all_re) if all_re else None,
    }


def floats(values):
    return [float(value) for value in values if value is not None]


def mean(values):
    return sum(values) / len(values) if values else None


def main():
    scene_path = sys.argv[1]
    target_cl = float(sys.argv[2])
    low = -12.0
    high = 18.0
    low_result = solve_alpha(scene_path, low)
    high_result = solve_alpha(scene_path, high)
    if not (low_result["CL"] <= target_cl <= high_result["CL"]):
        sample = solve_alpha(scene_path, 0.0)
        reference = high_result if target_cl > high_result["CL"] else low_result
        print(json.dumps({
            "ok": False,
            "message": "Target CL is outside the MachUpX alpha bracket.",
            "targetCL": target_cl,
            "alphaDeg": reference["alphaDeg"],
            "CL": reference["CL"],
            "CD": reference["CD"],
            "Cm": reference["Cm"],
            "LD": reference["CL"] / reference["CD"] if abs(reference["CD"]) > 1e-12 else math.inf,
            "low": low_result,
            "high": high_result,
            "sample": sample,
            "solverOutputs": solve_full(scene_path, reference["alphaDeg"]),
        }, default=convert))
        return

    best = None
    for _ in range(28):
        mid = (low + high) / 2
        result = solve_alpha(scene_path, mid)
        best = result
        if result["CL"] < target_cl:
            low = mid
        else:
            high = mid

    print(json.dumps({
        "ok": True,
        "targetCL": target_cl,
        "alphaDeg": best["alphaDeg"],
        "CL": best["CL"],
        "CD": best["CD"],
        "Cm": best["Cm"],
        "LD": best["CL"] / best["CD"] if abs(best["CD"]) > 1e-12 else math.inf,
        "solverOutputs": solve_full(scene_path, best["alphaDeg"]),
    }, default=convert))


if __name__ == "__main__":
    main()
