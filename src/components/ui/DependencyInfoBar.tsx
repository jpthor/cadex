import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppMode } from "../../app/types";

const dependencyInfo: Record<AppMode, string> = {
  sizing: "Sizing sets mission targets and suggestions. It feeds Sketch, Propulsion, Jet, Endurance, and Final, but does not overwrite actual geometry.",
  sketch: "Sketch uses Sizing for suggestions, then becomes the actual aircraft source for Aero and Propulsion.",
  compute: "Aero reads the actual Sketch geometry and mass to compute drag, stall, stability, cruise power, CoM, and CoP.",
  flight: "Flight reads the actual Sketch aircraft and movable surfaces, then previews mixer-driven control poses before you apply them back to Sketch.",
  openfoam: "OpenFOAM prepares CFD-ready surfaces and cases from the actual Sketch geometry, then compares clean, LEX, blown, and full-system variants.",
  paraview: "ParaView renders exported aircraft geometry and solver fields from the backend, so visual output comes from external CFD/mesh files.",
  propulsion: "Propulsion reads actual Sketch hardware and Aero demand, then compares the selected battery, motor, and prop against the mission.",
  jet: "Jet reads the Propulsion selection, selected Jet setup, Sizing mission, and Aero/Sketch aircraft to compare prop-only and hybrid results.",
  endurance: "Endurance holds base best-cruise speed, burns fuel over the flight, recomputes mass and drag, then compares fuel reserve against battery reserve.",
  ijet: "iJet turns the Endurance best split into command-mixing logic, capping prop command when battery current is the limiter and ramping jet command.",
  final: "Final reruns mass, Aero, Propulsion, Jet, and Endurance from the current inputs as the engineering handoff report.",
  max: "Max starts from Mission Inputs, generates Sizing geometry, converts it into Sketch masses, then runs Aero, theoretical Propulsion, Jet fuel, and Endurance.",
  design: "Design is the CAD workspace. Sketch/Sizing analysis does not rewrite CAD unless you explicitly apply or draw geometry.",
};

export function DependencyInfoBar({ mode }: { mode: AppMode }) {
  const storageKey = `cadex.dependencyInfo.dismissed.${mode}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === "1");

  useEffect(() => {
    setDismissed(localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (dismissed) return null;

  return (
    <div className="dependency-info-bar">
      <span>{dependencyInfo[mode]}</span>
      <button
        aria-label="Dismiss dependency note"
        onClick={() => {
          localStorage.setItem(storageKey, "1");
          setDismissed(true);
        }}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}
