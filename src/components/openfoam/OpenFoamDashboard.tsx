import { invoke } from "@tauri-apps/api/core";
import { Activity, FlaskConical, Gauge, Maximize2, Play, RotateCcw, Ruler, Waves, Wind } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { auditedSizingAssumptions, computeSketchAerodynamics, tailplaneAuthorityFactor } from "../../sizing";
import type { OpenFoamMovementAxis, OpenFoamMovementControl, OpenFoamStoredState, OpenFoamSurfaceCapture, SizeShape, SizingProject } from "../../sizing";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import { Metric } from "../ui/Metric";

type OpenFoamResult = {
  time: number;
  CD: number;
  CL: number;
  CmPitch: number;
  CmRoll?: number;
  CmYaw?: number;
  coefficientPath?: string;
};

type OpenFoamVariant = {
  id: string;
  label: string;
  ok: boolean;
  message: string;
  caseDir: string;
  componentCount: number;
  components: string[];
  reference?: {
    alphaDeg?: number;
    speedMS: number;
    referenceAreaM2: number;
    spanM: number;
    meanChordM: number;
  };
  result?: OpenFoamResult;
  surfaceResults?: {
    wing?: OpenFoamResult;
    wingevon?: OpenFoamResult;
    body?: OpenFoamResult;
    lex?: OpenFoamResult;
  };
  wingevonControl?: {
    mode: string;
    deflectionDeg: number;
    pivotChordFraction: number;
    note?: string;
  };
  preview?: {
    components: OpenFoamPreviewComponent[];
  };
  airflow?: {
    mode?: string;
    alphaDeg: number;
    speedMS?: number;
    time?: number;
    note?: string;
    wingevonControl?: OpenFoamVariant["wingevonControl"];
    plots?: AirflowPlotData[];
  };
  propSwirl?: {
    mode: string;
    expectedResult?: string;
  };
  vortexSections?: {
    time: number;
    measuredVsLex?: string;
    plot?: VortexPlotData;
    plots?: VortexPlotData[];
  };
};

type AirflowPlotData = {
  plane: string;
  label: string;
  point?: number[];
  bounds: {
    xMin: number;
    xMax: number;
    zMin: number;
    zMax: number;
  };
  sections?: Array<{
    name: string;
    kind: string;
    segments: Array<[[number, number], [number, number]]>;
  }>;
  samples: Array<{
    x: number;
    z: number;
    u: number;
    w: number;
    speed: number;
    cp?: number;
    omegaY?: number;
    pressurePa?: number;
    estimated?: boolean;
  }>;
  estimated?: boolean;
  scale: {
    maxSpeedMS: number;
    minCp?: number;
    maxCp?: number;
  };
};

type VortexPlotData = {
  plane: string;
  point?: number[];
  field: string;
  bounds: {
    yMin: number;
    yMax: number;
    zMin: number;
    zMax: number;
  };
  rotors: Array<{
    side: string;
    centerY: number;
    centerZ: number;
    radiusM: number;
    expectedOmegaXSign: number;
  }>;
  samples: Array<{
    y: number;
    z: number;
    omegaX: number;
  }>;
  scale: {
    maxAbsOmegaX: number;
    rotorRadiusM: number;
  };
};

type OpenFoamReport = {
  ok: boolean;
  solver?: string;
  message?: string;
  reportPath?: string;
  geometryDir?: string;
  movementControls?: OpenFoamMovementControl[];
  surfaceCaptures?: OpenFoamSurfaceCapture[];
  activeSurfaceCaptureId?: string;
  preview?: {
    components: Array<{
      name: string;
      kind: string;
      label?: string;
      color: string;
      triangles: number[][][];
    }>;
  };
  verification?: {
    ok: boolean;
    componentCount: number;
    missing?: string[];
    warnings?: string[];
  };
  variants?: OpenFoamVariant[];
};
type OpenFoamPreviewComponent = NonNullable<OpenFoamReport["preview"]>["components"][number];

type JobKind = "prepare" | "full" | "lexSweep" | "rotorWake" | "wingevonAlpha" | "cruise";
type TestCaseKind = Exclude<JobKind, "prepare"> | "tailSizing";
type OpenFoamTabKey = "prepare" | TestCaseKind;
type TailSizingJobState = "idle" | "running" | "complete";
type OpenFoamDashboardState = {
  geometryReport?: OpenFoamReport;
  geometryFingerprint?: string;
  movementControls?: OpenFoamMovementControl[];
  surfaceCaptures?: OpenFoamSurfaceCapture[];
  activeSurfaceCaptureId?: string;
  caseReports?: Partial<Record<Exclude<JobKind, "prepare">, OpenFoamReport>>;
  closedCases?: TestCaseKind[];
  tailSizingJob?: TailSizingJobState;
  tailSizingResult?: TailplaneSizingTest;
};

const jobLabels: Record<JobKind, string> = {
  prepare: "Prepare Geometry",
  full: "Run Full System",
  lexSweep: "Run LEX Sweep",
  rotorWake: "Rotor Wake",
  wingevonAlpha: "Wingevon Alpha",
  cruise: "Cruise",
};

function readOpenFoamProjectState(stored: OpenFoamStoredState | undefined): OpenFoamDashboardState {
  if (!stored) return {};
  const tailSizingResult = normalizeTailSizingResult(stored.tailSizingResult);
  return {
    geometryFingerprint: stored.geometryFingerprint,
    movementControls: stored.movementControls,
    surfaceCaptures: stored.surfaceCaptures,
    activeSurfaceCaptureId: stored.activeSurfaceCaptureId,
    closedCases: [],
    tailSizingJob: stored.tailSizingJob === "complete" && tailSizingResult ? "complete" : "idle",
    tailSizingResult,
  };
}

function normalizeTailSizingResult(value: unknown): TailplaneSizingTest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Partial<TailplaneSizingTest>;
  return Number.isFinite(result.wakeOnlyVolume) &&
    Number.isFinite(result.requiredAreaNoWakeM2) &&
    Number.isFinite(result.requiredAreaWithWakeM2)
    ? result as TailplaneSizingTest
    : undefined;
}

function buildOpenFoamProjectState(cache: OpenFoamDashboardState, saved?: OpenFoamStoredState): OpenFoamStoredState | undefined {
  const savedState = readOpenFoamProjectState(saved);
  const mergedClosedCases: TestCaseKind[] = [];
  const tailSizingResult = cache.tailSizingResult ?? savedState.tailSizingResult;
  const movementControls = cache.movementControls ?? savedState.movementControls;
  const surfaceCaptures = cache.surfaceCaptures ?? savedState.surfaceCaptures;
  const activeSurfaceCaptureId = cache.surfaceCaptures ? cache.activeSurfaceCaptureId : savedState.activeSurfaceCaptureId;
  const hasSavedWork =
    Boolean(movementControls?.length) ||
    Boolean(surfaceCaptures?.length) ||
    Boolean(tailSizingResult);
  if (!hasSavedWork) return undefined;
  return {
    geometryFingerprint: cache.geometryFingerprint ?? savedState.geometryFingerprint,
    movementControls,
    surfaceCaptures,
    activeSurfaceCaptureId,
    closedCases: mergedClosedCases,
    tailSizingJob: cache.tailSizingJob === "complete" || savedState.tailSizingJob === "complete" ? "complete" : "idle",
    tailSizingResult,
    updatedAt: Date.now(),
  };
}

function isTestCaseKind(value: string): value is TestCaseKind {
  return value === "full" || value === "lexSweep" || value === "rotorWake" || value === "wingevonAlpha" || value === "cruise" || value === "tailSizing";
}

function openFoamGeometryFingerprint(project: SizingProject) {
  return JSON.stringify({
    mission: project.mission,
    shapes: project.shapes,
    dimensions: project.dimensions,
  });
}

function openFoamDefaultCameraPosition(maxDim: number) {
  return new THREE.Vector3(maxDim * 1.02, -maxDim * 0.46, maxDim * 0.32);
}

function openFoamWheelZoomMultiplier(deltaY: number) {
  return Math.exp((deltaY < 0 ? 1 : -1) * 0.045);
}

function openFoamGestureZoomScale(scale: number) {
  return 1 + (scale - 1) * 0.35;
}

function projectWithAeroDerivedCruiseCl(
  project: SizingProject,
  movementControls: OpenFoamMovementControl[],
  surfaceCaptures: OpenFoamSurfaceCapture[],
  activeSurfaceCaptureId: string | undefined,
): SizingProject {
  const aero = computeSketchAerodynamics(project);
  const cruiseLiftCoefficient = aero.validity.lift && Number.isFinite(aero.aerodynamics.liftCoefficient)
    ? aero.aerodynamics.liftCoefficient
    : project.mission.cruiseLiftCoefficient;
  return {
    ...project,
    analysis: undefined,
    openFoam: movementControls.length || surfaceCaptures.length
      ? { movementControls, surfaceCaptures, activeSurfaceCaptureId }
      : undefined,
    mission: {
      ...project.mission,
      cruiseLiftCoefficient,
    },
  };
}

export function OpenFoamDashboard({
  onOpenFoamStateChange,
  onProjectChange,
  project,
  projectName,
}: {
  onOpenFoamStateChange?: (next: OpenFoamStoredState | undefined) => void;
  onProjectChange?: (next: SizingProject) => void;
  project: SizingProject;
  projectName: string;
}) {
  const activeProjectNameRef = useRef(projectName);
  const onOpenFoamStateChangeRef = useRef(onOpenFoamStateChange);
  const latestProjectOpenFoamRef = useRef(project.openFoam);
  const lastHydratedStateRef = useRef(JSON.stringify(project.openFoam ?? {}));
  const lastPersistedStateRef = useRef("");
  const skipNextPersistRef = useRef(true);
  const currentGeometryFingerprint = useMemo(() => openFoamGeometryFingerprint(project), [project]);
  const savedDashboard = useMemo(() => readOpenFoamProjectState(project.openFoam), [project.openFoam]);
  const [geometryReport, setGeometryReport] = useState<OpenFoamReport | undefined>(() => savedDashboard.geometryReport);
  const [geometryFingerprint, setGeometryFingerprint] = useState<string | undefined>(() =>
    savedDashboard.geometryFingerprint ?? (savedDashboard.geometryReport ? currentGeometryFingerprint : undefined),
  );
  const [movementControls, setMovementControls] = useState<OpenFoamMovementControl[]>(() => savedDashboard.movementControls ?? []);
  const [surfaceCaptures, setSurfaceCaptures] = useState<OpenFoamSurfaceCapture[]>(() => savedDashboard.surfaceCaptures ?? []);
  const [activeSurfaceCaptureId, setActiveSurfaceCaptureId] = useState<string | undefined>(() => savedDashboard.activeSurfaceCaptureId);
  const [caseReports, setCaseReports] = useState<Partial<Record<Exclude<JobKind, "prepare">, OpenFoamReport>>>(() => savedDashboard.caseReports ?? {});
  const [closedCases, setClosedCases] = useState<Set<TestCaseKind>>(() => new Set(savedDashboard.closedCases ?? []));
  const [runningJob, setRunningJob] = useState<JobKind | undefined>();
  const [activeTab, setActiveTab] = useState<OpenFoamTabKey>("prepare");
  const [tailSizingJob, setTailSizingJob] = useState<TailSizingJobState>(() => savedDashboard.tailSizingJob ?? "idle");
  const [tailSizingResult, setTailSizingResult] = useState<TailplaneSizingTest | undefined>(() => savedDashboard.tailSizingResult);
  const [error, setError] = useState<string | undefined>();
  const hasGeometry = project.shapes.some((shape) => ["body", "liftingSurface", "part"].includes(shape.role) && shape.points.length >= 2);
  const geometryValidated = Boolean(geometryReport?.ok && geometryReport.preview?.components?.length && geometryFingerprint === currentGeometryFingerprint);
  const latestGeometryReport = geometryValidated ? geometryReport : undefined;
  const testCases = useMemo(() => openFoamTestCases(), []);
  const activeTestCase = activeTab === "prepare" ? undefined : testCases.find((testCase) => testCase.kind === activeTab);

  useEffect(() => {
    onOpenFoamStateChangeRef.current = onOpenFoamStateChange;
  }, [onOpenFoamStateChange]);

  useEffect(() => {
    latestProjectOpenFoamRef.current = project.openFoam;
  }, [project.openFoam]);

  useEffect(() => {
    const serialized = JSON.stringify(project.openFoam ?? {});
    if (activeProjectNameRef.current === projectName && serialized === lastPersistedStateRef.current) return;
    const projectChanged = activeProjectNameRef.current !== projectName;
    skipNextPersistRef.current = true;
    const nextState = readOpenFoamProjectState(project.openFoam);
    setGeometryReport(nextState.geometryReport);
    setGeometryFingerprint(nextState.geometryFingerprint ?? (nextState.geometryReport ? currentGeometryFingerprint : undefined));
    setMovementControls(nextState.movementControls ?? []);
    setSurfaceCaptures(nextState.surfaceCaptures ?? []);
    setActiveSurfaceCaptureId(nextState.activeSurfaceCaptureId);
    setCaseReports(nextState.caseReports ?? {});
    setClosedCases(new Set(nextState.closedCases ?? []));
    setTailSizingJob(nextState.tailSizingJob ?? "idle");
    setTailSizingResult(nextState.tailSizingResult);
    setError(undefined);
    setRunningJob(undefined);
    if (projectChanged) setActiveTab("prepare");
    activeProjectNameRef.current = projectName;
    lastHydratedStateRef.current = serialized;
  }, [project.openFoam, projectName]);

  useEffect(() => {
    if (!geometryValidated && activeTab !== "prepare") setActiveTab("prepare");
  }, [activeTab, geometryValidated]);

  useEffect(() => {
    if (activeProjectNameRef.current !== projectName) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    if (runningJob || tailSizingJob === "running") return;
    const nextState = buildOpenFoamProjectState(
      {
        geometryReport,
        geometryFingerprint,
        movementControls,
        surfaceCaptures,
        activeSurfaceCaptureId,
        caseReports,
        closedCases: [...closedCases],
        tailSizingJob,
        tailSizingResult,
      },
      latestProjectOpenFoamRef.current,
    );
    const serialized = JSON.stringify(nextState ?? {});
    if (serialized === lastHydratedStateRef.current || serialized === lastPersistedStateRef.current) return;
    lastPersistedStateRef.current = serialized;
    onOpenFoamStateChangeRef.current?.(nextState);
  }, [activeSurfaceCaptureId, caseReports, closedCases, geometryFingerprint, geometryReport, movementControls, projectName, runningJob, surfaceCaptures, tailSizingJob, tailSizingResult]);

  function persistOpenFoamSnapshot(cache: Partial<OpenFoamDashboardState>) {
    const nextState = buildOpenFoamProjectState(
      {
        geometryReport,
        geometryFingerprint,
        movementControls,
        surfaceCaptures,
        activeSurfaceCaptureId,
        caseReports,
        closedCases: [...closedCases],
        tailSizingJob,
        tailSizingResult,
        ...cache,
      },
      latestProjectOpenFoamRef.current,
    );
    const serialized = JSON.stringify(nextState ?? {});
    lastPersistedStateRef.current = serialized;
    latestProjectOpenFoamRef.current = nextState;
    onOpenFoamStateChangeRef.current?.(nextState);
  }

  async function runJob(kind: JobKind) {
    if (!hasGeometry) return;
    setRunningJob(kind);
    setError(undefined);
    let nextClosedCases = [...closedCases];
    if (kind !== "prepare") {
      setCaseReports((current) => ({ ...current, [kind]: undefined }));
      nextClosedCases = nextClosedCases.filter((closedKind) => closedKind !== kind);
      setClosedCases(new Set(nextClosedCases));
    }
    const request = {
      projectName,
      sizing: projectWithAeroDerivedCruiseCl(project, movementControls, surfaceCaptures, activeSurfaceCaptureId),
      mesh: kind !== "prepare",
      solve: kind !== "prepare",
      lexSweep: kind === "lexSweep",
      propSwirlSweep: kind === "rotorWake",
      wingevonAlpha: kind === "wingevonAlpha",
      cruise: kind === "cruise",
      reuseGeometry: kind !== "prepare",
    };
    try {
      const nextReport = isTauriRuntime()
        ? await invoke<OpenFoamReport>("analyze_sizing_openfoam", { request })
        : await fetch("/api/openfoam", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          }).then((response) => response.json() as Promise<OpenFoamReport>);
      if (kind === "prepare") {
        setGeometryReport(nextReport);
        const nextGeometryFingerprint = nextReport.ok ? currentGeometryFingerprint : geometryFingerprint;
        if (nextReport.ok) {
          setGeometryFingerprint(nextGeometryFingerprint);
          setActiveTab("cruise");
        }
        persistOpenFoamSnapshot({
          geometryReport: nextReport,
          geometryFingerprint: nextGeometryFingerprint,
          closedCases: nextClosedCases,
        });
      } else {
        const nextCaseReports = { ...caseReports, [kind]: nextReport };
        const nextGeometryReport = !geometryReport && nextReport.preview?.components?.length ? nextReport : geometryReport;
        const nextGeometryFingerprint = nextGeometryReport === nextReport ? currentGeometryFingerprint : geometryFingerprint;
        setCaseReports(nextCaseReports);
        if (nextGeometryReport === nextReport) {
          setGeometryReport(nextGeometryReport);
          setGeometryFingerprint(nextGeometryFingerprint);
        }
        persistOpenFoamSnapshot({
          geometryReport: nextGeometryReport,
          geometryFingerprint: nextGeometryFingerprint,
          caseReports: nextCaseReports,
          closedCases: nextClosedCases,
        });
      }
      if (!nextReport.ok) setError(nextReport.message ?? "OpenFOAM job finished with warnings.");
    } catch (jobError) {
      setError(String(jobError));
    } finally {
      setRunningJob(undefined);
    }
  }

  function runTailSizingTest() {
    setClosedCases((current) => {
      const next = new Set(current);
      next.delete("tailSizing");
      return next;
    });
    setTailSizingResult(undefined);
    setTailSizingJob("running");
    window.setTimeout(() => {
      setTailSizingResult(buildTailplaneSizingTest(project));
      setTailSizingJob("complete");
    }, 180);
  }

  if (!hasGeometry) {
    return (
      <main className="compute-dashboard">
        <section className="compute-panel compute-empty">
          <h2>OpenFOAM</h2>
          <p>Draw the aircraft in Sketch before dispatching CFD jobs.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="compute-dashboard openfoam-dashboard">
      <section className="compute-panel compute-wide openfoam-tab-panel">
        <div className="openfoam-tabs-row">
          <div className="openfoam-tabs" aria-label="OpenFOAM pages">
            <button className={activeTab === "prepare" ? "active" : ""} onClick={() => setActiveTab("prepare")} type="button">
              <FlaskConical size={15} />
              <span>Prepare</span>
            </button>
            {geometryValidated
              ? testCases.map((testCase) => (
                  <button
                    className={activeTab === testCase.kind ? "active" : ""}
                    key={testCase.kind}
                    onClick={() => setActiveTab(testCase.kind)}
                    type="button"
                  >
                    {testCase.icon}
                    <span>{testCase.title.replace(/^Test Case: /, "")}</span>
                  </button>
                ))
              : null}
          </div>
          <div className="openfoam-tab-action">
            {activeTab === "prepare" ? (
              <JobButton
                disabled={Boolean(runningJob)}
                icon={<FlaskConical size={16} />}
                label="Prepare geometry"
                running={runningJob === "prepare"}
                onClick={() => void runJob("prepare")}
              />
            ) : activeTestCase ? (
              <JobButton
                disabled={Boolean(runningJob) || !geometryReport}
                icon={<Play size={16} />}
                label={activeTestCase.runLabel}
                running={activeTestCase.kind === "tailSizing" ? tailSizingJob === "running" : runningJob === activeTestCase.kind}
                onClick={() => {
                  if (activeTestCase.kind === "tailSizing") runTailSizingTest();
                  else void runJob(activeTestCase.kind);
                }}
              />
            ) : null}
          </div>
        </div>
        <OpenFoamMissionParameters activeTab={activeTab} onProjectChange={onProjectChange} project={project} />
        {activeTestCase ? <p className="openfoam-tab-description">{activeTestCase.description}</p> : null}
        {runningJob === "prepare" ? <JobIndicator label="Preparing geometry" /> : null}
        {activeTestCase && (runningJob === activeTestCase.kind || (activeTestCase.kind === "tailSizing" && tailSizingJob === "running")) ? (
          <JobIndicator label={`Running ${activeTestCase.title}`} />
        ) : null}
        {error ? <div className="openfoam-error-banner">{error}</div> : null}
        <div className="openfoam-tab-body">
          {activeTab === "prepare" ? (
            latestGeometryReport ? (
              <OpenFoamPrepareMovementWorkspace
                activeSurfaceCaptureId={activeSurfaceCaptureId}
                geometryFingerprint={geometryFingerprint}
                movementControls={movementControls}
                onActiveSurfaceCaptureIdChange={setActiveSurfaceCaptureId}
                onMovementControlsChange={setMovementControls}
                onSurfaceStateCommit={persistOpenFoamSnapshot}
                onSurfaceCapturesChange={setSurfaceCaptures}
                report={latestGeometryReport}
                surfaceCaptures={surfaceCaptures}
              />
            ) : <OpenFoamPreviewEmpty />
          ) : activeTestCase ? (
            <OpenFoamTestTab
              geometryReport={geometryReport}
              report={activeTestCase.kind === "tailSizing" ? undefined : caseReports[activeTestCase.kind]}
              rotorWakeReport={caseReports.rotorWake}
              running={activeTestCase.kind === "tailSizing" ? tailSizingJob === "running" : runningJob === activeTestCase.kind}
              tailSizingResult={activeTestCase.kind === "tailSizing" ? tailSizingResult : undefined}
              testCase={activeTestCase}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

type TailplaneSizingTest = {
  source: "Actual sketch" | "Reference test case";
  valid: boolean;
  targetVolume: number;
  rawVolume: number;
  wakeOnlyVolume: number;
  effectiveVolume: number;
  authorityFactor: number;
  wakeQRatio: number;
  allMovingFactor: number;
  marginPct: number;
  freeStreamMarginPct: number;
  wakeOnlyMarginPct: number;
  tailAreaM2: number;
  tailArmM: number;
  wingAreaM2: number;
  meanChordM: number;
  requiredAreaNoWakeM2: number;
  requiredAreaWithWakeM2: number;
  areaSavedByWakeM2: number;
};

type OpenFoamTestCase = {
  kind: TestCaseKind;
  title: string;
  description: string;
  icon: ReactNode;
  runLabel: string;
};

function openFoamTestCases(): OpenFoamTestCase[] {
  return [
    {
      kind: "cruise",
      title: "Cruise",
      description: "Models cruise-speed airflow over the aircraft with velocity vectors and pressure coefficient slices.",
      icon: <Gauge size={17} />,
      runLabel: "Run Cruise",
    },
    {
      kind: "full",
      title: "Full System",
      description: "Runs the complete exported aircraft geometry and returns force coefficients.",
      icon: <Play size={17} />,
      runLabel: "Run Full System",
    },
    {
      kind: "lexSweep",
      title: "LEX Sweep",
      description: "Compares clean and LEX geometry across angle-of-attack cases.",
      icon: <Wind size={17} />,
      runLabel: "Run LEX Sweep",
    },
    {
      kind: "rotorWake",
      title: "Rotor Wake",
      description: "Solves tops-in and bottoms-in prop-swirl cases and plots the vorticity section.",
      icon: <Waves size={17} />,
      runLabel: "Run Rotor Wake",
    },
    {
      kind: "wingevonAlpha",
      title: "Wingevon Alpha",
      description: "Runs 25 deg main-wing alpha with wingevons locked, then with wingevons rotated flat to the flow.",
      icon: <Activity size={17} />,
      runLabel: "Run 25 deg",
    },
    {
      kind: "tailSizing",
      title: "Test Case: Tail Sizing",
      description: "Checks tail volume and rotor-wake authority from the latest current Sketch geometry.",
      icon: <Ruler size={17} />,
      runLabel: "Run",
    },
  ];
}

function OpenFoamPreviewEmpty() {
  return (
    <div className="openfoam-preview-shell">
      <div className="openfoam-preview openfoam-preview-placeholder">
        <span>Run Prepare Geometry to load the exported OpenFOAM surfaces.</span>
      </div>
    </div>
  );
}

function OpenFoamMissionParameters({
  activeTab,
  onProjectChange,
  project,
}: {
  activeTab: OpenFoamTabKey;
  onProjectChange?: (next: SizingProject) => void;
  project: SizingProject;
}) {
  const updateMission = (patch: Partial<SizingProject["mission"]>) => {
    onProjectChange?.({ ...project, mission: { ...project.mission, ...patch }, analysis: undefined });
  };
  const speedKt = project.mission.cruiseSpeedMS / 0.514444;
  if (activeTab === "prepare") return <div className="openfoam-mission-panel empty" aria-label="Mission parameters" />;
  return (
    <div className="openfoam-mission-panel" aria-label="Mission parameters">
      <MissionNumberField
        disabled={!onProjectChange}
        label="Cruise speed"
        step={1}
        suffix="kt"
        value={speedKt}
        onChange={(value) => updateMission({ cruiseSpeedMS: Math.max(1, value * 0.514444) })}
      />
      {activeTab === "tailSizing" ? (
        <MissionNumberField
          disabled={!onProjectChange}
          label="Tail volume"
          max={1.2}
          min={0.1}
          step={0.05}
          value={project.mission.tailVolumeTarget}
          onChange={(value) => updateMission({ tailVolumeTarget: value })}
        />
      ) : null}
      {(activeTab === "rotorWake" || activeTab === "full") ? (
        <MissionNumberField
          disabled={!onProjectChange}
          label="Disk loading"
          min={1}
          step={5}
          suffix="N/m2"
          value={project.mission.diskLoadingNpm2}
          onChange={(value) => updateMission({ diskLoadingNpm2: value })}
        />
      ) : null}
    </div>
  );
}

function MissionNumberField({
  disabled,
  label,
  max,
  min,
  onChange,
  step,
  suffix,
  value,
}: {
  disabled?: boolean;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step: number;
  suffix?: string;
  value: number;
}) {
  return (
    <label className="openfoam-mission-field">
      <span>{label}</span>
      <div>
        <input
          disabled={disabled}
          max={max}
          min={min}
          step={step}
          type="number"
          value={Number.isFinite(value) ? Number(value.toFixed(step < 1 ? 2 : 0)) : ""}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

function JobIndicator({ label }: { label: string }) {
  return (
    <div className="openfoam-job-indicator">
      <RotateCcw className="spin" size={15} />
      <span>{label}</span>
    </div>
  );
}

function OpenFoamTestTab({
  geometryReport,
  report,
  rotorWakeReport,
  running,
  tailSizingResult,
  testCase,
}: {
  geometryReport: OpenFoamReport | undefined;
  report: OpenFoamReport | undefined;
  rotorWakeReport?: OpenFoamReport;
  running: boolean;
  tailSizingResult?: TailplaneSizingTest;
  testCase: OpenFoamTestCase;
}) {
  const hasCaseCanvas = Boolean(
    (testCase.kind === "cruise" && report) ||
    (testCase.kind === "wingevonAlpha" && report) ||
    (testCase.kind === "tailSizing" && tailSizingResult),
  );
  return (
    <div className="openfoam-test-page">
      {!hasCaseCanvas && geometryReport ? <OpenFoamMeshPreview report={geometryReport} /> : null}
      {!running ? <OpenFoamTestCaseVisualiser geometryReport={geometryReport} report={report} rotorWakeReport={rotorWakeReport} tailSizingResult={tailSizingResult} testCase={testCase} /> : null}
    </div>
  );
}

function OpenFoamTestCaseVisualiser({ geometryReport, report, rotorWakeReport, tailSizingResult, testCase }: { geometryReport?: OpenFoamReport; report?: OpenFoamReport; rotorWakeReport?: OpenFoamReport; tailSizingResult?: TailplaneSizingTest; testCase: OpenFoamTestCase }) {
  if (testCase.kind === "tailSizing") return tailSizingResult ? <TailplaneSizingTestPanel geometryReport={geometryReport} rotorWakeReport={rotorWakeReport} test={tailSizingResult} /> : null;
  if (!report) return null;
  if (testCase.kind === "lexSweep") {
    const rows = buildLexRows(report);
    if (!rows.length) return null;
    return (
      <div className="openfoam-test-visualiser">
        <OpenFoamChart rows={rows} />
        <OpenFoamLexTable rows={rows} />
      </div>
    );
  }
  if (testCase.kind === "rotorWake") {
    const wakeVariants = (report.variants ?? []).filter((variant) => variant.vortexSections?.plot);
    if (!wakeVariants.length) return null;
    return (
      <div className="openfoam-wake-stack">
        {wakeVariants.map((variant) => (
          <RotorWakeImage key={variant.id} variant={variant} />
        ))}
      </div>
    );
  }
  if (testCase.kind === "cruise") return <CruiseAirflowPanel fallbackPreview={geometryReport?.preview} report={report} />;
  if (testCase.kind === "wingevonAlpha") return <WingevonAirflowPanel report={report} />;
  return <OpenFoamCaseResults report={report} />;
}

function CruiseAirflowPanel({ fallbackPreview, report }: { fallbackPreview?: OpenFoamReport["preview"]; report: OpenFoamReport }) {
  const variant = (report.variants ?? []).find((entry) => entry.airflow) ?? report.variants?.[0];
  const plots = variant?.airflow?.plots ?? [];
  const [selectedPlane, setSelectedPlane] = useState(plots[0]?.plane ?? "");
  useEffect(() => {
    if (!plots.length) return;
    if (!plots.some((plot) => plot.plane === selectedPlane)) setSelectedPlane(plots[0].plane);
  }, [plots, selectedPlane]);
  if (!variant?.airflow) return <OpenFoamCaseResults report={report} />;
  const hasEstimated = plots.some((plot) => plot.samples.some((sample) => sample.estimated));
  const selectedPlot = plots.find((plot) => plot.plane === selectedPlane) ?? plots[0];
  const sectionCount = selectedPlot?.sections?.reduce((sum, section) => sum + (section.segments?.length ?? 0), 0) ?? 0;
  const sampleCount = selectedPlot?.samples.length ?? 0;
  const peakSpeed = selectedPlot ? Math.max(selectedPlot.scale.maxSpeedMS, ...selectedPlot.samples.map((sample) => sample.speed), 0) : 0;
  const hasSolvedFlow = sampleCount > 0 && !hasEstimated;
  return (
    <article className="openfoam-airflow-card">
      <div className="openfoam-airflow-title">
        <div>
          <strong>{variant.label}</strong>
          <span>Pressure color, flow direction, and the aircraft cross-section at cruise speed.</span>
        </div>
      </div>
      <div className="openfoam-view-options" aria-label="Cruise view options">
        <div className="openfoam-cruise-tabs" aria-label="Cruise flow section">
          {plots.map((plot) => (
            <button className={plot.plane === selectedPlot?.plane ? "active" : undefined} key={plot.plane} onClick={() => setSelectedPlane(plot.plane)} type="button">
              {cruisePlaneLabel(plot)}
            </button>
          ))}
        </div>
      </div>
      <div className="openfoam-cruise-view">
        {selectedPlot ? <CruiseFlowHero plot={selectedPlot} preview={report.preview ?? fallbackPreview} /> : null}
        {selectedPlot ? <CruiseStationAnimation plot={selectedPlot} /> : null}
      </div>
      <div className="compute-machupx-grid openfoam-result-grid">
        <Metric label="Cruise speed" value={`${(variant.reference?.speedMS ?? variant.airflow.speedMS ?? 0).toFixed(1)} m/s`} />
        <Metric label="Flow field" note={hasSolvedFlow ? `OpenFOAM time ${variant.airflow.time ?? "--"}` : "Run Cruise to solve and sample OpenFOAM turbulence fields."} noteTone={hasSolvedFlow ? "good" : "caution"} value={hasSolvedFlow ? "solved" : "not solved"} />
        <Metric label="Displayed section" value={selectedPlot ? cruisePlaneLabel(selectedPlot) : "--"} />
        <Metric label="Mesh slice segments" value={sectionCount ? `${sectionCount}` : "--"} />
        <Metric label="Samples" value={sampleCount ? `${sampleCount}` : "--"} />
        <Metric label="Peak local speed" value={peakSpeed ? `${peakSpeed.toFixed(1)} m/s` : "--"} />
      </div>
    </article>
  );
}

function CruiseStationAnimation({ plot }: { plot: AirflowPlotData }) {
  const width = 960;
  const height = 330;
  const pad = { left: 48, right: 28, top: 24, bottom: 34 };
  const xSpan = Math.max(plot.bounds.xMax - plot.bounds.xMin, 0.001);
  const zSpan = Math.max(plot.bounds.zMax - plot.bounds.zMin, 0.001);
  const maxSpeed = Math.max(plot.scale.maxSpeedMS, ...plot.samples.map((sample) => sample.speed), 0.001);
  const meanU = plot.samples.length ? plot.samples.reduce((sum, sample) => sum + sample.u, 0) / plot.samples.length : 1;
  const visualFlowDirection = 1;
  const xFor = (x: number) => pad.left + ((x - plot.bounds.xMin) / xSpan) * (width - pad.left - pad.right);
  const yFor = (z: number) => height - pad.bottom - ((z - plot.bounds.zMin) / zSpan) * (height - pad.top - pad.bottom);
  const nearestSample = (x: number, z: number) => {
    let nearest = plot.samples[0];
    let nearestDistance = Infinity;
    for (const sample of plot.samples) {
      const distance = Math.pow((sample.x - x) / xSpan, 2) + Math.pow((sample.z - z) / zSpan, 2);
      if (distance < nearestDistance) {
        nearest = sample;
        nearestDistance = distance;
      }
    }
    return nearest;
  };
  const pathFor = (lane: number, laneCount: number) => {
    const tLane = laneCount <= 1 ? 0.5 : lane / (laneCount - 1);
    let z = plot.bounds.zMin + zSpan * (0.08 + tLane * 0.84);
    const points: string[] = [];
    const steps = 26;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = visualFlowDirection > 0 ? plot.bounds.xMin + xSpan * t : plot.bounds.xMax - xSpan * t;
      const sample = nearestSample(x, z);
      const axial = Math.max(Math.abs(sample.u), maxSpeed * 0.08);
      const drift = clamp(sample.w / axial, -0.55, 0.55) * (zSpan / steps) * 1.5;
      z = clamp(z + drift, plot.bounds.zMin + zSpan * 0.025, plot.bounds.zMax - zSpan * 0.025);
      points.push(`${step === 0 ? "M" : "L"} ${xFor(x).toFixed(1)} ${yFor(z).toFixed(1)}`);
    }
    return points.join(" ");
  };
  const pressureColor = (cp = 0) => {
    const clamped = clamp(cp, -1.35, 1.35);
    if (clamped < 0) {
      const intensity = Math.abs(clamped) / 1.35;
      return `rgb(${Math.round(42 + intensity * 25)}, ${Math.round(112 + intensity * 70)}, 255)`;
    }
    const intensity = clamped / 1.35;
    return `rgb(255, ${Math.round(222 - intensity * 126)}, ${Math.round(88 - intensity * 28)})`;
  };
  const fieldCols = 64;
  const fieldRows = 24;
  const fieldCellWidth = (width - pad.left - pad.right) / fieldCols;
  const fieldCellHeight = (height - pad.top - pad.bottom) / fieldRows;
  const fieldCells = Array.from({ length: fieldCols * fieldRows }, (_, index) => {
    const col = index % fieldCols;
    const row = Math.floor(index / fieldCols);
    const x = plot.bounds.xMin + xSpan * ((col + 0.5) / fieldCols);
    const z = plot.bounds.zMax - zSpan * ((row + 0.5) / fieldRows);
    const sample = nearestSample(x, z);
    const speedRatio = clamp(sample.speed / maxSpeed, 0, 1);
    const cp = sample.cp ?? (1 - speedRatio * speedRatio);
    return {
      color: pressureColor(cp),
      key: `${col}-${row}`,
      opacity: 0.34 + speedRatio * 0.48,
      x: pad.left + col * fieldCellWidth,
      y: pad.top + row * fieldCellHeight,
    };
  });
  const eddyPath = (radius: number) => {
    const loops = 2.4;
    const points: string[] = [];
    const steps = 56;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const angle = t * Math.PI * 2 * loops;
      const r = radius * (1 - t * 0.74);
      points.push(`${step === 0 ? "M" : "L"} ${(Math.cos(angle) * r).toFixed(1)} ${(Math.sin(angle) * r).toFixed(1)}`);
    }
    return points.join(" ");
  };
  const turbulenceSamples = [...plot.samples]
    .filter((sample) => Number.isFinite(sample.omegaY))
    .sort((a, b) => {
      const scoreA = Math.abs(a.omegaY ?? 0);
      const scoreB = Math.abs(b.omegaY ?? 0);
      return scoreB - scoreA;
    })
    .filter((sample, index, samples) =>
      index < 80 &&
      samples.slice(0, index).every((other) => Math.hypot((other.x - sample.x) / xSpan, (other.z - sample.z) / zSpan) > 0.11),
    )
    .slice(0, 14);
  const laneCount = 42;
  const streamPaths = Array.from({ length: laneCount }, (_, index) => ({
    delay: -((index * 0.37) % 5.6),
    duration: 4.8 + (index % 5) * 0.55,
    id: index,
    path: pathFor(index, laneCount),
  }));
  const markerId = `stationFlowArrow-${plot.plane}`;
  return (
    <div className="openfoam-station-flow">
      <div className="openfoam-station-flow-title">
        <strong>{cruisePlaneLabel(plot)} animated flow</strong>
        <span>{plot.samples.length ? `${plot.samples.length} samples over ${Math.round(maxSpeed)} m/s peak speed` : "Run Cruise to populate this station"}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${cruisePlaneLabel(plot)} animated 2D flow`}>
        <defs>
          <marker id={markerId} markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5">
            <path d="M0,0 L7,3.5 L0,7 Z" />
          </marker>
          <pattern id={`stationFlowGrid-${plot.plane}`} width="38" height="38" patternUnits="userSpaceOnUse">
            <path d="M 38 0 L 0 0 0 38" fill="none" stroke="rgba(142, 177, 198, 0.08)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect className="station-flow-bg" height={height} width={width} x="0" y="0" />
        <rect fill={`url(#stationFlowGrid-${plot.plane})`} height={height - pad.top - pad.bottom} width={width - pad.left - pad.right} x={pad.left} y={pad.top} />
        {fieldCells.map((cell) => (
          <rect
            className="station-flow-cell"
            fill={cell.color}
            height={fieldCellHeight + 1}
            key={cell.key}
            opacity={cell.opacity}
            width={fieldCellWidth + 1}
            x={cell.x}
            y={cell.y}
          />
        ))}
        {turbulenceSamples.map((sample, index) => {
          const omega = Math.abs(sample.omegaY ?? 0);
          const radius = 8 + Math.min(omega / 40, 1) * 22;
          return (
            <g
              className="station-flow-eddy"
              key={`eddy-${sample.x}-${sample.z}-${index}`}
              style={{ "--eddy-delay": `${-(index * 0.41)}s`, "--eddy-duration": `${3.1 + (index % 5) * 0.48}s` } as Record<string, string>}
              transform={`translate(${xFor(sample.x).toFixed(1)} ${yFor(sample.z).toFixed(1)}) rotate(${(sample.omegaY ?? 0) >= 0 ? 0 : 180})`}
            >
              <path d={eddyPath(radius)} />
            </g>
          );
        })}
        {plot.samples.length && !turbulenceSamples.length ? (
          <text className="station-flow-warning" x={pad.left} y={height - 16}>No OpenFOAM vorticity samples in this result. Run Cruise again to solve turbulence fields.</text>
        ) : null}
        {streamPaths.map((stream) => (
          <g key={stream.id}>
            <path className="station-flow-line" d={stream.path} />
            <path
              className="station-flow-pulse"
              d={stream.path}
              markerEnd={`url(#${markerId})`}
              style={{ "--flow-delay": `${stream.delay}s`, "--flow-duration": `${stream.duration}s` } as Record<string, string>}
            />
          </g>
        ))}
        {(plot.sections ?? []).flatMap((section) =>
          (section.segments ?? []).map((segment, index) => (
            <line
              className={`station-flow-section ${section.kind}`}
              key={`${section.name}-${index}`}
              x1={xFor(segment[0][0])}
              x2={xFor(segment[1][0])}
              y1={yFor(segment[0][1])}
              y2={yFor(segment[1][1])}
            />
          )),
        )}
        <text className="station-flow-label" x={pad.left} y={18}>time animated 2D slice</text>
        <text className="station-flow-label" x={width - 180} y={height - 10}>nose-tail station flow</text>
      </svg>
    </div>
  );
}

function cruisePlaneLabel(plot: AirflowPlotData) {
  if (plot.plane.includes("centreline") || plot.plane.includes("centerline")) return "Centreline";
  if (plot.plane.includes("pod")) return "Pod";
  if (plot.plane.includes("wingtip")) return "Wingtip";
  return plot.label.replace(" pressure / velocity", "").replace(" cruise section", "").replace(" section", "");
}

function WingevonAirflowPanel({ report }: { report: OpenFoamReport }) {
  const variants = (report.variants ?? []).filter((variant) => variant.airflow);
  const [selectedVariantId, setSelectedVariantId] = useState(variants[0]?.id ?? "");
  useEffect(() => {
    if (!variants.length) return;
    if (!variants.some((variant) => variant.id === selectedVariantId)) setSelectedVariantId(variants[0].id);
  }, [selectedVariantId, variants]);
  if (!variants.length) return <OpenFoamCaseResults report={report} />;
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) ?? variants[0];
  return (
    <article className="openfoam-wingevon-analysis">
      <div className="openfoam-airflow-title">
        <div>
          <strong>Wingevon at 25 deg alpha</strong>
          <span>3D geometry first, sampled flow second. Use the two cases to compare locked wingevons against wingevons flattened to the incoming flow.</span>
        </div>
      </div>
      <div className="openfoam-view-options" aria-label="Wingevon view options">
        <div className="openfoam-wingevon-tabs" aria-label="Wingevon alpha case">
          {variants.map((variant) => (
            <button
              className={variant.id === selectedVariant.id ? "active" : undefined}
              key={variant.id}
              onClick={() => setSelectedVariantId(variant.id)}
              type="button"
            >
              <strong>{variant.wingevonControl?.deflectionDeg ? "Flat to flow" : "Locked"}</strong>
              <span>{formatSigned(variant.wingevonControl?.deflectionDeg, 0)} deg wingevon</span>
            </button>
          ))}
        </div>
      </div>
      <WingevonAirflowCard fallbackPreview={report.preview} variant={selectedVariant} />
    </article>
  );
}

function WingevonAirflowCard({ fallbackPreview, variant }: { fallbackPreview?: OpenFoamReport["preview"]; variant: OpenFoamVariant }) {
  const plots = variant.airflow?.plots ?? [];
  const hasSamples = plots.some((plot) => plot.samples.length > 0);
  const isEstimated = hasSamples && plots.every((plot) => plot.estimated || plot.samples.every((sample) => sample.estimated));
  return (
    <div className="openfoam-wingevon-selected">
      <div className="openfoam-wingevon-hero">
        <WingevonFlowScene fallbackPreview={fallbackPreview} isEstimated={isEstimated} variant={variant} />
      </div>
      <div className="openfoam-wingevon-metrics">
        <Metric label="Alpha" value={`${(Number.isFinite(variant.reference?.alphaDeg) ? variant.reference?.alphaDeg ?? 25 : 25).toFixed(0)} deg`} />
        <Metric label="Case status" note={variant.caseDir} noteTone={variant.result ? "good" : "caution"} value={variant.result ? "solved" : variant.message} />
        <Metric label="Wing CL" value={variant.surfaceResults?.wing ? variant.surfaceResults.wing.CL.toFixed(3) : "--"} />
        <Metric label="Wingevon CL" value={variant.surfaceResults?.wingevon ? variant.surfaceResults.wingevon.CL.toFixed(3) : "--"} />
        <Metric
          label="Flow field"
          value={hasSamples ? (isEstimated ? "preview" : "solved") : "run solve"}
          note={hasSamples ? (isEstimated ? "Estimated until OpenFOAM writes sample planes." : `time ${variant.airflow?.time ?? "--"}`) : "Run the case to populate streamlines."}
          noteTone={isEstimated ? "caution" : hasSamples ? "good" : "caution"}
        />
      </div>
    </div>
  );
}

function WingevonSectionPreview({ plots }: { plots: AirflowPlotData[] }) {
  const [selectedPlane, setSelectedPlane] = useState(plots[0]?.plane ?? "");
  useEffect(() => {
    if (!plots.length) return;
    if (!plots.some((plot) => plot.plane === selectedPlane)) setSelectedPlane(plots[0].plane);
  }, [plots, selectedPlane]);
  const selectedPlot = plots.find((plot) => plot.plane === selectedPlane) ?? plots[0];
  if (!selectedPlot) return null;
  return (
    <div className="openfoam-wingevon-section">
      <div className="openfoam-view-options" aria-label="Wingevon section view options">
        <div className="openfoam-cruise-tabs" aria-label="Wingevon flow section">
          {plots.map((plot) => (
            <button className={plot.plane === selectedPlot.plane ? "active" : undefined} key={plot.plane} onClick={() => setSelectedPlane(plot.plane)} type="button">
              {plot.label.replace(" section", "")}
            </button>
          ))}
        </div>
      </div>
      <AirflowPlot compact plot={selectedPlot} />
    </div>
  );
}

function WingevonFlowScene({ fallbackPreview, isEstimated, variant }: { fallbackPreview?: OpenFoamReport["preview"]; isEstimated: boolean; variant: OpenFoamVariant }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const panOffsetRef = useRef(new THREE.Vector3());
  const zoomRef = useRef(1);
  const [viewResetCount, setViewResetCount] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    const components = variant.preview?.components ?? fallbackPreview?.components ?? [];
    if (!mount || !components.length) return undefined;

    const width = Math.max(mount.clientWidth, 360);
    const height = Math.max(Math.min(mount.clientHeight || 500, 520), 360);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.domElement.style.background = "transparent";
    mount.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 200);
    camera.up.set(0, 0, 1);
    const group = new THREE.Group();
    scene.add(group);

    const plots = variant.airflow?.plots ?? [];
    const speedCloud = plots.flatMap((plot) => plot.samples.map((sample) => ({
      x: sample.x,
      y: plot.point?.[1] ?? 0,
      z: sample.z,
      speed: sample.speed,
      u: sample.u,
      w: sample.w,
    })));
    const referenceSpeed = variant.reference?.speedMS ?? variant.airflow?.speedMS ?? 20;
    const maxVelocity = Math.max(...speedCloud.map((sample) => sample.speed), referenceSpeed, 1);
    const minVelocity = Math.min(...speedCloud.map((sample) => sample.speed), 0);
    const speedCache = new Map<string, number>();

    for (const component of components) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (const tri of component.triangles) {
        for (const point of tri) {
          positions.push(point[1], point[0], point[2]);
          const speed = speedAtGeometryPoint(point, speedCloud, referenceSpeed, speedCache);
          const color = velocityColor(speed, minVelocity, maxVelocity);
          colors.push(color.r, color.g, color.b);
        }
      }
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const { color, opacity } = wingevonSceneStyle(component.kind, component.color);
      const material = new THREE.MeshStandardMaterial({
        color,
        vertexColors: true,
        transparent: opacity < 1,
        opacity,
        metalness: 0.03,
        roughness: 0.68,
        side: THREE.DoubleSide,
        depthWrite: opacity > 0.42,
      });
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 22),
        new THREE.LineBasicMaterial({ color: 0x16242c, transparent: true, opacity: component.kind === "body" ? 0.18 : 0.32 }),
      );
      group.add(edges);
    }

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const flowGroup = new THREE.Group();
    for (const plot of plots) {
      for (const line of streamlinesForPlot(plot, maxVelocity)) flowGroup.add(line);
    }
    group.add(flowGroup);
    group.position.sub(center);
    group.position.add(panOffsetRef.current);

    const maxDim = Math.max(size.x, size.y, size.z, 1);
    camera.fov = 32;
    camera.updateProjectionMatrix();
    const cameraBasePosition = openFoamDefaultCameraPosition(maxDim);
    const applyZoom = (nextZoom = zoomRef.current) => {
      const cameraScale = 1 / nextZoom;
      camera.position.copy(cameraBasePosition).multiplyScalar(cameraScale);
      camera.lookAt(0, 0, 0);
    };
    const updateZoom = (nextZoom: number) => {
      zoomRef.current = clamp(nextZoom, 0.6, 4);
      applyZoom();
    };
    applyZoom();
    scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x17252e, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.7);
    key.position.set(4, -5, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8bdcff, 0.8);
    fill.position.set(-3, 4, 3);
    scene.add(fill);

    let animationFrame = 0;
    let dragging = false;
    let panning = false;
    let lastPointer = { x: 0, y: 0 };
    let lastTrackballPoint = new THREE.Vector3();
    const projectToTrackball = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const radius = Math.max(Math.min(rect.width, rect.height) * 0.5, 1);
      const x = (event.clientX - rect.left - rect.width * 0.5) / radius;
      const y = (event.clientY - rect.top - rect.height * 0.5) / radius;
      const lengthSq = x * x + y * y;
      if (lengthSq <= 1) return new THREE.Vector3(x, y, Math.sqrt(1 - lengthSq)).normalize();
      return new THREE.Vector3(x, y, 0).normalize();
    };
    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      dragging = true;
      panning = event.shiftKey || event.button === 1 || event.button === 2;
      lastPointer = { x: event.clientX, y: event.clientY };
      lastTrackballPoint = projectToTrackball(event);
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      event.preventDefault();
      if (panning) {
        const dx = event.clientX - lastPointer.x;
        const dy = event.clientY - lastPointer.y;
        const panScale = (maxDim * 0.0022) / zoomRef.current;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(dx * panScale);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dy * panScale);
        const delta = right.add(up);
        group.position.add(delta);
        panOffsetRef.current.add(delta);
        lastPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      const nextTrackballPoint = projectToTrackball(event);
      const axis = new THREE.Vector3().crossVectors(lastTrackballPoint, nextTrackballPoint);
      const axisLength = axis.length();
      if (axisLength > 1e-5) {
        axis.normalize().applyQuaternion(camera.quaternion).normalize();
        const angle = Math.atan2(axisLength, lastTrackballPoint.dot(nextTrackballPoint));
        group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      }
      lastTrackballPoint = nextTrackballPoint;
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    let gestureBaseZoom = zoomRef.current;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        updateZoom(zoomRef.current * openFoamWheelZoomMultiplier(event.deltaY));
        return;
      }
      const panScale = (maxDim * 0.0018) / zoomRef.current;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(-event.deltaX * panScale);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(event.deltaY * panScale);
      const delta = right.add(up);
      group.position.add(delta);
      panOffsetRef.current.add(delta);
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureBaseZoom = zoomRef.current;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = typeof (event as Event & { scale?: number }).scale === "number" ? (event as Event & { scale: number }).scale : 1;
      updateZoom(gestureBaseZoom * openFoamGestureZoomScale(scale));
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("gesturestart", onGestureStart);
    renderer.domElement.addEventListener("gesturechange", onGestureChange);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const render = () => {
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("gesturestart", onGestureStart);
      renderer.domElement.removeEventListener("gesturechange", onGestureChange);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      mount.replaceChildren();
    };
  }, [fallbackPreview, variant, viewResetCount]);

  return (
    <OpenFoamCanvasShell
      mountRef={mountRef}
      rootClassName="openfoam-wingevon-scene"
      onFit={() => {
          panOffsetRef.current.set(0, 0, 0);
          zoomRef.current = 1;
          setViewResetCount((current) => current + 1);
      }}
    >
      <div className="openfoam-velocity-legend">
        <span>velocity</span>
        <i />
        <em>40</em>
        <em>20</em>
        <em>0</em>
      </div>
      <div className="openfoam-wingevon-scene-label">
        <strong>{variant.wingevonControl?.deflectionDeg ? "Wingevons flat to flow" : "Wingevons locked"}</strong>
        <span>{isEstimated ? "preview streamlines from geometry" : "white streamlines from solved OpenFOAM samples"}</span>
      </div>
    </OpenFoamCanvasShell>
  );
}

function wingevonSceneStyle(kind: string, fallbackColor: string) {
  if (kind === "wingevon") return { color: new THREE.Color("#ffffff"), opacity: 0.98 };
  if (kind === "wing") return { color: new THREE.Color("#ffffff"), opacity: 0.95 };
  if (kind === "body") return { color: new THREE.Color("#ffffff"), opacity: 0.88 };
  if (kind === "tailplane" || kind === "fin") return { color: new THREE.Color("#ffffff"), opacity: 0.82 };
  return { color: new THREE.Color(fallbackColor || "#ffffff"), opacity: 0.62 };
}

function speedAtGeometryPoint(point: number[], samples: Array<{ x: number; y: number; z: number; speed: number }>, fallback: number, cache: Map<string, number>) {
  if (!samples.length) return fallback;
  const key = `${point[0].toFixed(2)}:${point[1].toFixed(2)}:${point[2].toFixed(2)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let best = samples[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    const distance = Math.abs(sample.x - point[0]) * 0.9 + Math.abs(sample.y - point[1]) * 1.7 + Math.abs(sample.z - point[2]) * 1.2;
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }
  const blended = best.speed * Math.exp(-Math.min(bestDistance, 2.8) * 0.42) + fallback * (1 - Math.exp(-Math.min(bestDistance, 2.8) * 0.42));
  cache.set(key, blended);
  return blended;
}

function velocityColor(speed: number, min: number, max: number) {
  const t = clamp((speed - min) / Math.max(max - min, 0.001), 0, 1);
  const stops = [
    { t: 0, color: new THREE.Color("#1e4cff") },
    { t: 0.22, color: new THREE.Color("#12b7ff") },
    { t: 0.48, color: new THREE.Color("#1ee35f") },
    { t: 0.72, color: new THREE.Color("#f4e84a") },
    { t: 0.88, color: new THREE.Color("#ff8a25") },
    { t: 1, color: new THREE.Color("#f43f3f") },
  ];
  const upperIndex = stops.findIndex((stop) => stop.t >= t);
  const upper = stops[Math.max(upperIndex, 1)];
  const lower = stops[Math.max(0, stops.indexOf(upper) - 1)];
  return lower.color.clone().lerp(upper.color, (t - lower.t) / Math.max(upper.t - lower.t, 0.001));
}

function streamlinesForPlot(plot: AirflowPlotData, maxVelocity: number) {
  if (!plot.samples.length) return [];
  const baseY = plot.point?.[1] ?? 0;
  const yStations = Math.abs(baseY) > 0.12
    ? [baseY, baseY * 0.52, -baseY * 0.52, -baseY]
    : [baseY];
  const xSpan = Math.max(plot.bounds.xMax - plot.bounds.xMin, 0.001);
  const zSpan = Math.max(plot.bounds.zMax - plot.bounds.zMin, 0.001);
  const nearest = (x: number, z: number) => {
    let best = plot.samples[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const sample of plot.samples) {
      const distance = Math.abs(sample.x - x) / xSpan + Math.abs(sample.z - z) / zSpan;
      if (distance < bestDistance) {
        best = sample;
        bestDistance = distance;
      }
    }
    return best;
  };
  const lines: THREE.Line[] = [];
  const seedCount = yStations.length > 1 ? 9 : 18;
  for (const y of yStations) {
    for (let index = 0; index < seedCount; index += 1) {
      const offset = (index + 0.5) / seedCount;
      let z = plot.bounds.zMin + zSpan * offset;
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 72; step += 1) {
        const x = plot.bounds.xMin + (xSpan * step) / 72;
        const sample = nearest(x, z);
        const speedRatio = clamp(sample.speed / Math.max(maxVelocity, 0.001), 0, 1);
        z += (sample.w / Math.max(maxVelocity, 0.001)) * zSpan * 0.025;
        z += Math.sin(step * 0.23 + index * 0.9 + y * 1.7) * zSpan * 0.0009;
        z = clamp(z, plot.bounds.zMin, plot.bounds.zMax);
        points.push(new THREE.Vector3(y, x, z + (speedRatio - 0.5) * zSpan * 0.003));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(110));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: index % 3 === 0 ? 0.72 : 0.42,
          depthTest: false,
        }),
      );
      lines.push(line);
    }
  }
  return lines;
}

function CruiseFlowHero({ plot, preview }: { plot: AirflowPlotData; preview?: OpenFoamReport["preview"] }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const panOffsetRef = useRef(new THREE.Vector3());
  const zoomRef = useRef(1);
  const [viewResetCount, setViewResetCount] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    const components = preview?.components ?? [];
    if (!mount || !components.length) return undefined;

    const width = Math.max(mount.clientWidth, 520);
    const height = Math.max(Math.min(mount.clientHeight || 480, 500), 360);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.domElement.style.background = "transparent";
    mount.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x5b6173);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 300);
    camera.up.set(0, 0, 1);
    const group = new THREE.Group();
    scene.add(group);

    const velocityColor = (speedT: number) => {
      const t = clamp(speedT, 0, 1);
      if (t < 0.18) return new THREE.Color(0x1f49ff).lerp(new THREE.Color(0x00b7ff), t / 0.18);
      if (t < 0.45) return new THREE.Color(0x00b7ff).lerp(new THREE.Color(0x1ee45e), (t - 0.18) / 0.27);
      if (t < 0.72) return new THREE.Color(0x1ee45e).lerp(new THREE.Color(0xf2e71f), (t - 0.45) / 0.27);
      return new THREE.Color(0xf2e71f).lerp(new THREE.Color(0xff4a1d), (t - 0.72) / 0.28);
    };

    for (const component of components) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (const tri of component.triangles) {
        for (const point of tri) {
          positions.push(point[1], point[0], point[2]);
          const longitudinalT = (point[0] - plot.bounds.xMin) / Math.max(plot.bounds.xMax - plot.bounds.xMin, 0.001);
          const kindBoost = component.kind === "body" ? 0.18 : component.kind === "part" ? -0.12 : component.kind === "fin" ? 0.28 : 0.06;
          const color = velocityColor(0.42 + Math.sin(longitudinalT * Math.PI * 1.4) * 0.26 + kindBoost);
          colors.push(color.r, color.g, color.b);
        }
      }
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.08,
        roughness: 0.55,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 25),
        new THREE.LineBasicMaterial({ color: 0x0c3a32, transparent: true, opacity: 0.28 }),
      );
      group.add(edges);
    }

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const sliceY = plot.point?.[1] ?? 0;

    const sliceGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(sliceY, plot.bounds.xMin, plot.bounds.zMin),
      new THREE.Vector3(sliceY, plot.bounds.xMax, plot.bounds.zMin),
      new THREE.Vector3(sliceY, plot.bounds.xMax, plot.bounds.zMax),
      new THREE.Vector3(sliceY, plot.bounds.xMin, plot.bounds.zMax),
    ]);
    sliceGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    sliceGeometry.computeVertexNormals();
    const slicePlane = new THREE.Mesh(
      sliceGeometry,
      new THREE.MeshBasicMaterial({ color: 0x72d7ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    group.add(slicePlane);
    const sliceOutline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(sliceY, plot.bounds.xMin, plot.bounds.zMin),
        new THREE.Vector3(sliceY, plot.bounds.xMax, plot.bounds.zMin),
        new THREE.Vector3(sliceY, plot.bounds.xMax, plot.bounds.zMax),
        new THREE.Vector3(sliceY, plot.bounds.xMin, plot.bounds.zMax),
      ]),
      new THREE.LineBasicMaterial({ color: 0xaff0ff, transparent: true, opacity: 0.82 }),
    );
    group.add(sliceOutline);

    const streamlineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78 });
    const sliceBand = Math.max(size.x * 0.035, 0.025);
    const yMin = sliceY - sliceBand;
    const yMax = sliceY + sliceBand;
    const zBase = box.min.z + size.z * 0.62;
    for (let lane = 0; lane < 28; lane += 1) {
      const lateral = yMin + ((yMax - yMin) * lane) / 27;
      const heightOffset = ((lane % 14) - 6.5) * size.z * 0.025;
      const points: THREE.Vector3[] = [];
      for (let step = 0; step < 72; step += 1) {
        const t = step / 71;
        const longitudinal = box.max.y + size.y * 0.26 - t * size.y * 1.58;
        const bodyWake = Math.exp(-Math.pow((t - 0.48) / 0.22, 2));
        const wheelCurl = Math.sin(t * Math.PI * 5 + lane * 0.5) * size.x * 0.025 * bodyWake;
        const vertical = zBase + heightOffset + Math.sin(t * Math.PI * 2.2 + lane * 0.35) * size.z * 0.08 * bodyWake;
        points.push(new THREE.Vector3(lateral + wheelCurl, longitudinal, vertical));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(120));
      const line = new THREE.Line(geometry, streamlineMaterial.clone());
      group.add(line);
    }

    group.position.sub(center);
    const cameraBasePosition = openFoamDefaultCameraPosition(maxDim);
    const applyZoom = (nextZoom = zoomRef.current) => {
      const cameraScale = 1 / nextZoom;
      camera.position.copy(cameraBasePosition).multiplyScalar(cameraScale);
      camera.lookAt(0, 0, 0);
    };
    const updateZoom = (nextZoom: number) => {
      zoomRef.current = clamp(nextZoom, 0.6, 4);
      applyZoom();
    };
    applyZoom();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2f38, 2.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.9);
    key.position.set(3, 5, 4);
    scene.add(key);

    let dragging = false;
    let panning = false;
    let lastPointer = { x: 0, y: 0 };
    let lastTrackballPoint = new THREE.Vector3();
    let animationFrame = 0;
    const projectToTrackball = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const radius = Math.max(Math.min(rect.width, rect.height) * 0.5, 1);
      const x = (event.clientX - rect.left - rect.width * 0.5) / radius;
      const y = (rect.height * 0.5 - (event.clientY - rect.top)) / radius;
      const lengthSq = x * x + y * y;
      if (lengthSq <= 1) return new THREE.Vector3(x, y, Math.sqrt(1 - lengthSq)).normalize();
      return new THREE.Vector3(x, y, 0).normalize();
    };
    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      dragging = true;
      panning = event.shiftKey || event.button === 1 || event.button === 2;
      lastPointer = { x: event.clientX, y: event.clientY };
      lastTrackballPoint = projectToTrackball(event);
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      event.preventDefault();
      if (panning) {
        const dx = event.clientX - lastPointer.x;
        const dy = event.clientY - lastPointer.y;
        const panScale = (maxDim * 0.0022) / zoomRef.current;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(dx * panScale);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dy * panScale);
        const delta = right.add(up);
        group.position.add(delta);
        panOffsetRef.current.add(delta);
        lastPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      const nextTrackballPoint = projectToTrackball(event);
      const axis = new THREE.Vector3().crossVectors(lastTrackballPoint, nextTrackballPoint);
      const axisLength = axis.length();
      if (axisLength > 1e-5) {
        axis.normalize().applyQuaternion(camera.quaternion).normalize();
        const angle = Math.atan2(axisLength, lastTrackballPoint.dot(nextTrackballPoint));
        group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      }
      lastTrackballPoint = nextTrackballPoint;
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerUp);
    const onContextMenu = (event: Event) => event.preventDefault();
    let gestureBaseZoom = zoomRef.current;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        updateZoom(zoomRef.current * openFoamWheelZoomMultiplier(event.deltaY));
        return;
      }
      const panScale = (maxDim * 0.0018) / zoomRef.current;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(-event.deltaX * panScale);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(event.deltaY * panScale);
      const delta = right.add(up);
      group.position.add(delta);
      panOffsetRef.current.add(delta);
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureBaseZoom = zoomRef.current;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = typeof (event as Event & { scale?: number }).scale === "number" ? (event as Event & { scale: number }).scale : 1;
      updateZoom(gestureBaseZoom * openFoamGestureZoomScale(scale));
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("gesturestart", onGestureStart);
    renderer.domElement.addEventListener("gesturechange", onGestureChange);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const render = () => {
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      renderer.dispose();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("gesturestart", onGestureStart);
      renderer.domElement.removeEventListener("gesturechange", onGestureChange);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      mount.replaceChildren();
    };
  }, [plot, preview, viewResetCount]);

  return (
    <>
      <OpenFoamCanvasShell
        canvasClassName="openfoam-cruise-scene"
        mountRef={mountRef}
        rootClassName="openfoam-cruise-hero"
        onFit={() => {
          panOffsetRef.current.set(0, 0, 0);
          zoomRef.current = 1;
          setViewResetCount((current) => current + 1);
        }}
      >
        <div className="openfoam-velocity-legend" aria-hidden="true">
          <span>velocity</span>
          <i />
          <em>{Math.round(plot.scale.maxSpeedMS)}</em>
          <em>{Math.round(plot.scale.maxSpeedMS / 2)}</em>
          <em>0</em>
        </div>
        <div className="openfoam-cruise-slice-label">
          <strong>{cruisePlaneLabel(plot)}</strong>
          <span>Y station {(plot.point?.[1] ?? 0).toFixed(2)} m</span>
        </div>
      </OpenFoamCanvasShell>
      <CruisePressureCurves plot={plot} />
    </>
  );
}

function CruisePressureCurves({ plot }: { plot: AirflowPlotData }) {
  const width = 840;
  const height = 190;
  const pad = { left: 42, right: 18, top: 22, bottom: 30 };
  const xSpan = Math.max(plot.bounds.xMax - plot.bounds.xMin, 0.001);
  const cpValues = plot.samples.map((sample) => sample.cp ?? 0);
  const cpMin = Math.min(-1, ...cpValues);
  const cpMax = Math.max(1, ...cpValues);
  const zMid = (plot.bounds.zMin + plot.bounds.zMax) / 2;
  const bins = 44;
  const traces = ["upper", "lower"].map((side) => {
    const points: Array<[number, number]> = [];
    for (let index = 0; index < bins; index += 1) {
      const x0 = plot.bounds.xMin + (xSpan * index) / bins;
      const x1 = plot.bounds.xMin + (xSpan * (index + 1)) / bins;
      const bucket = plot.samples.filter((sample) => sample.x >= x0 && sample.x <= x1 && (side === "upper" ? sample.z >= zMid : sample.z < zMid));
      if (!bucket.length) continue;
      const cp = bucket.reduce((sum, sample) => sum + (sample.cp ?? 0), 0) / bucket.length;
      points.push([(x0 + x1) / 2, cp]);
    }
    return { side, points };
  });
  const xFor = (x: number) => pad.left + ((x - plot.bounds.xMin) / xSpan) * (width - pad.left - pad.right);
  const yFor = (cp: number) => pad.top + ((cp - cpMin) / Math.max(cpMax - cpMin, 0.001)) * (height - pad.top - pad.bottom);
  const pathFor = (points: Array<[number, number]>) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(point[0]).toFixed(1)} ${yFor(point[1]).toFixed(1)}`).join(" ");
  return (
    <div className="openfoam-pressure-curves">
      <div>
        <strong>Pressure curves</strong>
        <span>{cruisePlaneLabel(plot)} longitudinal slice</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${cruisePlaneLabel(plot)} pressure curves`}>
        <line className="pressure-axis" x1={pad.left} x2={width - pad.right} y1={yFor(0)} y2={yFor(0)} />
        <line className="pressure-axis" x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} />
        {traces.map((trace) => (
          <path className={`pressure-curve ${trace.side}`} d={pathFor(trace.points)} key={trace.side} />
        ))}
        <text x={pad.left} y={16}>Cp</text>
        <text x={width - 82} y={height - 8}>nose to tail</text>
        <text className="pressure-label upper" x={width - 190} y={30}>upper surface</text>
        <text className="pressure-label lower" x={width - 190} y={48}>lower surface</text>
      </svg>
    </div>
  );
}

function AirflowPlot({ compact = false, plot }: { compact?: boolean; plot: AirflowPlotData }) {
  const width = 560;
  const height = compact ? 220 : 300;
  const pad = 36;
  const xSpan = Math.max(plot.bounds.xMax - plot.bounds.xMin, 0.001);
  const zSpan = Math.max(plot.bounds.zMax - plot.bounds.zMin, 0.001);
  const maxSpeed = Math.max(plot.scale.maxSpeedMS, ...plot.samples.map((sample) => sample.speed), 0.001);
  const xFor = (x: number) => pad + ((x - plot.bounds.xMin) / xSpan) * (width - pad * 2);
  const yFor = (z: number) => height - pad - ((z - plot.bounds.zMin) / zSpan) * (height - pad * 2);
  const arrowSamples = plot.samples.filter((_, index) => index % Math.max(1, Math.ceil(plot.samples.length / (compact ? 20 : 34))) === 0);
  const pressureSamples = plot.samples.filter((_, index) => index % Math.max(1, Math.ceil(plot.samples.length / (compact ? 32 : 52))) === 0);
  const markerId = `airflowArrow-${plot.plane}`;
  const pressureColor = (cp = 0) => {
    const clamped = clamp(cp, -1.2, 1.2);
    if (clamped < 0) {
      const intensity = Math.abs(clamped) / 1.2;
      return `rgba(${Math.round(48 + intensity * 30)}, ${Math.round(140 + intensity * 80)}, 255, ${0.18 + intensity * 0.52})`;
    }
    const intensity = clamped / 1.2;
    return `rgba(255, ${Math.round(210 - intensity * 100)}, ${Math.round(82 - intensity * 18)}, ${0.18 + intensity * 0.52})`;
  };
  return (
    <div className={compact ? "openfoam-airflow-plot compact" : "openfoam-airflow-plot"}>
      <div className="openfoam-airflow-plot-title">
        <strong>{plot.label}</strong>
        <span>{plot.samples.length ? `${plot.samples.length} ${plot.estimated ? "estimated" : "solved"} samples` : "no solved samples yet"}</span>
      </div>
      <svg className="openfoam-airflow-image" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${plot.label} airflow vectors`}>
        <defs>
          <marker id={markerId} markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
            <path d="M0,0 L6,3 L0,6 Z" />
          </marker>
          <pattern id={`airflowGrid-${plot.plane}`} width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M 44 0 L 0 0 0 44" fill="none" stroke="rgba(147, 180, 200, 0.08)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect className="airflow-bg" x="0" y="0" width={width} height={height} />
        <rect fill={`url(#airflowGrid-${plot.plane})`} x={pad} y={pad} width={width - pad * 2} height={height - pad * 2} />
        <line className="airflow-axis" x1={pad} x2={width - pad} y1={yFor(0)} y2={yFor(0)} />
        {pressureSamples.map((sample, index) => (
          <circle
            key={`pressure-${sample.x}-${sample.z}-${index}`}
            className="airflow-pressure"
            cx={xFor(sample.x)}
            cy={yFor(sample.z)}
            fill={pressureColor(sample.cp)}
            r={6.5}
          />
        ))}
        {arrowSamples.map((sample, index) => {
          const length = 23 * Math.min(sample.speed / maxSpeed, 1);
          const direction = Math.hypot(sample.u, sample.w) || 1;
          const dx = (sample.u / direction) * length;
          const dy = -(sample.w / direction) * length;
          const intensity = Math.min(sample.speed / maxSpeed, 1);
          return (
            <line
              key={`${sample.x}-${sample.z}-${index}`}
              className="airflow-vector"
              markerEnd={`url(#${markerId})`}
              style={{ opacity: 0.24 + intensity * 0.72 }}
              x1={xFor(sample.x)}
              x2={xFor(sample.x) + dx}
              y1={yFor(sample.z)}
              y2={yFor(sample.z) + dy}
            />
          );
        })}
        {(plot.sections ?? []).flatMap((section) =>
          (section.segments ?? []).map((segment, index) => (
            <line
              className={`airflow-section ${section.kind}`}
              key={`${section.name}-${index}`}
              x1={xFor(segment[0][0])}
              x2={xFor(segment[1][0])}
              y1={yFor(segment[0][1])}
              y2={yFor(segment[1][1])}
            />
          )),
        )}
        {!plot.samples.length ? <text className="airflow-empty" x={width / 2 - 100} y={height / 2}>Run the case to populate airflow vectors</text> : null}
        {compact ? null : <text className="airflow-axis-label" x={pad} y={22}>aircraft cross-section in white</text>}
        <text className="airflow-axis-label" x={width - 156} y={height - 10}>pressure color</text>
        <text className="airflow-axis-label" x={pad} y={height - 10}>peak {maxSpeed.toFixed(1)} m/s</text>
      </svg>
    </div>
  );
}

function OpenFoamCaseResults({ report }: { report: OpenFoamReport }) {
  const variants = report.variants ?? [];
  if (!variants.length) return null;
  return (
    <div className="compute-machupx-grid">
      {variants.map((variant) => (
        <Metric
          key={variant.id}
          label={variant.label}
          note={variant.caseDir}
          noteTone={variant.ok ? "good" : "bad"}
          value={variant.result ? `CL ${variant.result.CL.toFixed(3)} / CD ${variant.result.CD.toFixed(3)}` : variant.message}
        />
      ))}
    </div>
  );
}

function OpenFoamLexTable({ rows }: { rows: LexRow[] }) {
  return (
    <div className="openfoam-table">
      <div className="openfoam-row header">
        <span>Alpha</span>
        <span>Clean CL</span>
        <span>LEX CL</span>
        <span>dCL</span>
        <span>Wing dCL</span>
        <span>Body dCL</span>
        <span>LEX self</span>
      </div>
      {rows.map((row) => (
        <div className="openfoam-row" key={row.alphaDeg}>
          <span>{row.alphaDeg.toFixed(0)} deg</span>
          <span>{format(row.cleanCL, 3)}</span>
          <span>{format(row.lexCL, 3)}</span>
          <span>{formatSigned(row.deltaCL, 4)}</span>
          <span>{formatSigned(row.wingDeltaCL, 4)}</span>
          <span>{formatSigned(row.bodyDeltaCL, 4)}</span>
          <span>{formatSigned(row.lexSelfCL, 4)}</span>
        </div>
      ))}
    </div>
  );
}

function RotorWakeImage({ variant }: { variant: OpenFoamVariant }) {
  const plot = variant.vortexSections?.plot;
  if (!plot) return null;
  const width = 560;
  const height = 330;
  const pad = 34;
  const ySpan = Math.max(plot.bounds.yMax - plot.bounds.yMin, 0.001);
  const zSpan = Math.max(plot.bounds.zMax - plot.bounds.zMin, 0.001);
  const maxAbs = Math.max(plot.scale.maxAbsOmegaX, 0.001);
  const xFor = (y: number) => pad + ((y - plot.bounds.yMin) / ySpan) * (width - pad * 2);
  const yFor = (z: number) => height - pad - ((z - plot.bounds.zMin) / zSpan) * (height - pad * 2);
  const colorFor = (omegaX: number) => {
    const intensity = Math.min(Math.abs(omegaX) / maxAbs, 1);
    const alpha = 0.2 + intensity * 0.78;
    return omegaX >= 0 ? `rgba(255, 83, 99, ${alpha})` : `rgba(72, 190, 255, ${alpha})`;
  };
  const strongest = [...plot.samples]
    .sort((a, b) => Math.abs(b.omegaX) - Math.abs(a.omegaX))
    .slice(0, 700);
  return (
    <article className="openfoam-wake-card">
      <div className="openfoam-wake-title">
        <strong>{variant.label}</strong>
        <span>{variant.vortexSections?.measuredVsLex ?? variant.propSwirl?.expectedResult}</span>
      </div>
      <svg className="openfoam-wake-image" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${variant.label} rotor wake vorticity`}>
        <defs>
          <pattern id={`wakeGrid-${variant.id}`} width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(147, 180, 200, 0.14)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect className="wake-bg" x="0" y="0" width={width} height={height} />
        <rect fill={`url(#wakeGrid-${variant.id})`} x={pad} y={pad} width={width - pad * 2} height={height - pad * 2} />
        <line className="wake-axis" x1={pad} x2={width - pad} y1={yFor(0)} y2={yFor(0)} />
        <line className="wake-axis" x1={xFor(0)} x2={xFor(0)} y1={pad} y2={height - pad} />
        {strongest.map((sample, index) => (
          <circle
            key={`${sample.y}-${sample.z}-${index}`}
            cx={xFor(sample.y)}
            cy={yFor(sample.z)}
            fill={colorFor(sample.omegaX)}
            r={1.8 + Math.min(Math.abs(sample.omegaX) / maxAbs, 1) * 3.6}
          />
        ))}
        {plot.rotors.map((rotor) => (
          <g key={rotor.side}>
            <circle className="wake-rotor" cx={xFor(rotor.centerY)} cy={yFor(rotor.centerZ)} r={(rotor.radiusM / ySpan) * (width - pad * 2)} />
            <text className="wake-label" x={xFor(rotor.centerY) - 18} y={yFor(rotor.centerZ) + 4}>{rotor.side}</text>
          </g>
        ))}
        <text className="wake-axis-label" x={pad} y={22}>spanwise Y</text>
        <text className="wake-axis-label" x={width - 90} y={height - 10}>blue -omega.x / red +omega.x</text>
      </svg>
      <div className="openfoam-wake-meta">
        <span>{plot.plane}</span>
        <span>time {variant.vortexSections?.time ?? "--"}</span>
        <span>max |omega.x| {plot.scale.maxAbsOmegaX.toFixed(2)}</span>
      </div>
    </article>
  );
}

function TailplaneSizingTestPanel({ geometryReport, rotorWakeReport, test }: { geometryReport?: OpenFoamReport; rotorWakeReport?: OpenFoamReport; test: TailplaneSizingTest }) {
  const rawWidth = Math.max(4, Math.min(100, (test.rawVolume / Math.max(test.targetVolume, 0.01)) * 100));
  const wakeOnlyWidth = Math.max(4, Math.min(130, (test.wakeOnlyVolume / Math.max(test.targetVolume, 0.01)) * 100));
  const effectiveWidth = Math.max(4, Math.min(130, (test.effectiveVolume / Math.max(test.targetVolume, 0.01)) * 100));
  const targetPct = 100 / 1.3;
  const effectivePct = Math.min(100, (effectiveWidth / 130) * 100);
  const verdict = test.valid && test.marginPct >= 0 ? "passes target" : "undersized";
  const verdictTone = test.valid && test.marginPct >= 0 ? "good" : "bad";
  const rotorWakeSamples = rotorWakeReport?.variants?.reduce((sum, variant) => sum + (variant.vortexSections?.plot?.samples.length ?? 0), 0) ?? 0;
  const rotorWakeStatus = rotorWakeSamples > 0 ? `${rotorWakeSamples} solved samples` : "run Rotor Wake";

  return (
    <div className="openfoam-tail-test">
      <div className="openfoam-tail-visual" aria-label="Tailplane sizing visual test case">
        {geometryReport ? <TailSizingPreparedPreview report={geometryReport} rotorWakeReport={rotorWakeReport} test={test} /> : <div className="openfoam-tail-prepared-empty">Run Prepare Geometry first.</div>}
        <div className="openfoam-tail-bars">
          <div className="openfoam-tail-bar">
            <span>Raw geometry</span>
            <div><i style={{ width: `${rawWidth}%` }} /></div>
            <strong>{test.rawVolume.toFixed(2)}</strong>
          </div>
          <div className="openfoam-tail-bar wake-only">
            <span>In rotor wake</span>
            <div>
              <i style={{ width: `${wakeOnlyWidth}%` }} />
              <b style={{ left: `${targetPct}%` }} />
            </div>
            <strong>{test.wakeOnlyVolume.toFixed(2)}</strong>
          </div>
          <div className="openfoam-tail-bar effective">
            <span>Effective authority</span>
            <div>
              <i style={{ width: `${effectiveWidth}%` }} />
              <b style={{ left: `${targetPct}%` }} />
              <em style={{ left: `${effectivePct}%` }} />
            </div>
            <strong>{test.effectiveVolume.toFixed(2)}</strong>
          </div>
          <div className="openfoam-tail-scale">
            <span>0</span>
            <span>target {test.targetVolume.toFixed(2)}</span>
            <span>+30%</span>
          </div>
        </div>
      </div>
      <div className="openfoam-tail-assessment">
        <div className="compute-machupx-grid openfoam-tail-metrics">
          <Metric label="Test source" value={test.source} />
          <Metric label="Result" note={test.valid ? `${formatSigned(test.marginPct, 0)}% margin to target` : "needs wing and tail geometry"} noteTone={verdictTone} value={verdict} />
          <Metric label="Rotor wake data" note={rotorWakeSamples > 0 ? "FOAM wake case available" : "Use Rotor Wake to verify q ratio"} noteTone={rotorWakeSamples > 0 ? "good" : "caution"} value={rotorWakeStatus} />
          <Metric label="Target tail volume" value={test.targetVolume.toFixed(2)} />
        </div>
        <div className="openfoam-tail-effectiveness-card">
          <h4>Rotor-wake effectiveness</h4>
          <div className="openfoam-tail-effectiveness-row">
            <span>Free-stream tail</span>
            <strong>{test.rawVolume.toFixed(3)}</strong>
            <em className={test.freeStreamMarginPct >= 0 ? "good" : "bad"}>{formatSigned(test.freeStreamMarginPct, 0)}%</em>
          </div>
          <div className="openfoam-tail-effectiveness-row">
            <span>Rotor wake only</span>
            <strong>{test.wakeOnlyVolume.toFixed(3)}</strong>
            <em className={test.wakeOnlyMarginPct >= 0 ? "good" : "bad"}>{formatSigned(test.wakeOnlyMarginPct, 0)}%</em>
          </div>
          <div className="openfoam-tail-effectiveness-row">
            <span>Wake + all-moving</span>
            <strong>{test.effectiveVolume.toFixed(3)}</strong>
            <em className={test.marginPct >= 0 ? "good" : "bad"}>{formatSigned(test.marginPct, 0)}%</em>
          </div>
          <div className="openfoam-tail-effectiveness-row muted">
            <span>q ratio / all-moving</span>
            <strong>{test.wakeQRatio.toFixed(2)}x / {test.allMovingFactor.toFixed(2)}x</strong>
            <em>{test.authorityFactor.toFixed(2)}x total</em>
          </div>
          <div className="openfoam-tail-effectiveness-row muted">
            <span>Area required without wake</span>
            <strong>{test.requiredAreaNoWakeM2.toFixed(3)} m2</strong>
            <em>{test.tailAreaM2.toFixed(3)} m2 actual</em>
          </div>
          <div className="openfoam-tail-effectiveness-row muted">
            <span>Area required with wake</span>
            <strong>{test.requiredAreaWithWakeM2.toFixed(3)} m2</strong>
            <em>{test.areaSavedByWakeM2.toFixed(3)} m2 saved</em>
          </div>
        </div>
      </div>
    </div>
  );
}

function TailSizingPreparedPreview({ report, rotorWakeReport, test }: { report: OpenFoamReport; rotorWakeReport?: OpenFoamReport; test: TailplaneSizingTest }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const panOffsetRef = useRef(new THREE.Vector3());
  const zoomRef = useRef(1);
  const [viewResetCount, setViewResetCount] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    const components = report.preview?.components ?? [];
    if (!mount || !components.length) return undefined;

    const width = Math.max(mount.clientWidth, 320);
    const height = 310;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.domElement.style.background = "transparent";
    mount.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 200);
    camera.up.set(0, 0, 1);
    const group = new THREE.Group();
    scene.add(group);

    const componentMeshes: Array<{ component: OpenFoamPreviewComponent; mesh: THREE.Mesh }> = [];
    for (const component of components) {
      const positions: number[] = [];
      for (const tri of component.triangles) {
        for (const point of tri) positions.push(point[1], point[0], point[2]);
      }
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const { color, opacity } = tailPreviewStyle(component.kind);
      const material = new THREE.MeshStandardMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        metalness: 0.03,
        roughness: 0.74,
        side: THREE.DoubleSide,
        depthWrite: opacity > 0.45,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = component.name;
      group.add(mesh);
      componentMeshes.push({ component, mesh });
    }

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    group.position.sub(center);
    group.position.add(panOffsetRef.current);

    const tailSurfaceEntries = componentMeshes.filter((entry) => entry.component.kind === "tailplane" || entry.component.kind === "fin");
    const tailBoxes = tailSurfaceEntries.map((entry) => new THREE.Box3().setFromObject(entry.mesh));
    const wingBoxes = componentMeshes.filter((entry) => entry.component.kind === "wing" || entry.component.kind === "wingevon").map((entry) => new THREE.Box3().setFromObject(entry.mesh));
    const rotorBoxes = componentMeshes.filter((entry) => entry.component.kind === "rotor").map((entry) => new THREE.Box3().setFromObject(entry.mesh));
    const tailCenter = boxesCenter(tailBoxes);
    const wingCenter = boxesCenter(wingBoxes);
    const maxDim = Math.max(size.x, size.y, size.z, 1);

    if (tailCenter && wingCenter) {
      group.add(markerSphere(wingCenter, 0x6fb7ff, Math.max(size.length() * 0.012, 0.018)));
      group.add(markerSphere(tailCenter, 0xc4b5fd, Math.max(size.length() * 0.014, 0.02)));
      group.add(lineBetween(wingCenter, tailCenter, 0xf8fafc));
    }

    const tailWakePlot = findTailWakePlot(rotorWakeReport);
    if (tailWakePlot) group.add(openFoamVorticitySection(tailWakePlot));

    const cameraBasePosition = openFoamDefaultCameraPosition(maxDim);
    const applyZoom = (nextZoom = zoomRef.current) => {
      const cameraScale = 1 / nextZoom;
      camera.position.copy(cameraBasePosition).multiplyScalar(cameraScale);
      camera.lookAt(0, 0, 0);
    };
    const updateZoom = (nextZoom: number) => {
      zoomRef.current = clamp(nextZoom, 0.55, 4.5);
      applyZoom();
    };
    applyZoom();

    scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x17252e, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, -5, 4);
    scene.add(key);

    let animationFrame = 0;
    let dragging = false;
    let panning = false;
    let lastPointer = { x: 0, y: 0 };
    let lastTrackballPoint = new THREE.Vector3();
    const projectToTrackball = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const radius = Math.max(Math.min(rect.width, rect.height) * 0.5, 1);
      const x = (event.clientX - rect.left - rect.width * 0.5) / radius;
      const y = (rect.height * 0.5 - (event.clientY - rect.top)) / radius;
      const lengthSq = x * x + y * y;
      if (lengthSq <= 1) return new THREE.Vector3(x, y, Math.sqrt(1 - lengthSq)).normalize();
      return new THREE.Vector3(x, y, 0).normalize();
    };
    const panBy = (dx: number, dy: number) => {
      const panScale = (maxDim * 0.0022) / zoomRef.current;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(dx * panScale);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dy * panScale);
      const delta = right.add(up);
      group.position.add(delta);
      panOffsetRef.current.add(delta);
    };
    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      dragging = true;
      panning = event.shiftKey || event.button === 1 || event.button === 2;
      lastPointer = { x: event.clientX, y: event.clientY };
      lastTrackballPoint = projectToTrackball(event);
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      event.preventDefault();
      if (panning) {
        panBy(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
        lastPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      const nextTrackballPoint = projectToTrackball(event);
      const axis = new THREE.Vector3().crossVectors(lastTrackballPoint, nextTrackballPoint);
      const axisLength = axis.length();
      if (axisLength > 1e-5) {
        axis.normalize().applyQuaternion(camera.quaternion).normalize();
        const angle = Math.atan2(axisLength, lastTrackballPoint.dot(nextTrackballPoint));
        group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      }
      lastTrackballPoint = nextTrackballPoint;
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const onPointerCancel = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        updateZoom(zoomRef.current * openFoamWheelZoomMultiplier(event.deltaY));
        return;
      }
      panBy(-event.deltaX, -event.deltaY);
    };
    let gestureBaseZoom = zoomRef.current;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureBaseZoom = zoomRef.current;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = typeof (event as Event & { scale?: number }).scale === "number" ? (event as Event & { scale: number }).scale : 1;
      updateZoom(gestureBaseZoom * openFoamGestureZoomScale(scale));
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    renderer.domElement.addEventListener("pointerleave", onPointerCancel);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("gesturestart", onGestureStart);
    renderer.domElement.addEventListener("gesturechange", onGestureChange);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const render = () => {
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("pointerleave", onPointerCancel);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("gesturestart", onGestureStart);
      renderer.domElement.removeEventListener("gesturechange", onGestureChange);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      mount.replaceChildren();
    };
  }, [report, rotorWakeReport, viewResetCount]);

  return (
    <OpenFoamCanvasShell
      canvasClassName="openfoam-tail-prepared-canvas"
      fitClassName="openfoam-tail-fit"
      mountRef={mountRef}
      rootClassName="openfoam-tail-prepared"
      onFit={() => {
          panOffsetRef.current.set(0, 0, 0);
          zoomRef.current = 1;
          setViewResetCount((current) => current + 1);
      }}
    >
      <div className="openfoam-tail-prepared-pills">
        <span><i className="tail" /> tail</span>
        <span><i className="wake" /> OpenFOAM wake</span>
        <span><i className="turbulence" /> sampled vorticity</span>
        <span>{test.tailArmM.toFixed(2)} m arm</span>
      </div>
    </OpenFoamCanvasShell>
  );
}

function tailPreviewStyle(kind: string) {
  if (kind === "tailplane") return { color: new THREE.Color("#c4b5fd"), opacity: 0.9 };
  if (kind === "rotor") return { color: new THREE.Color("#7dd3fc"), opacity: 0.55 };
  if (kind === "wing" || kind === "wingevon") return { color: new THREE.Color("#6fb7ff"), opacity: 0.42 };
  return { color: new THREE.Color("#8aa0ad"), opacity: 0.13 };
}

function boxesCenter(boxes: THREE.Box3[]) {
  if (!boxes.length) return undefined;
  return mergeThreeBoxes(boxes).getCenter(new THREE.Vector3());
}

function boxesSize(boxes: THREE.Box3[]) {
  if (!boxes.length) return new THREE.Vector3();
  return mergeThreeBoxes(boxes).getSize(new THREE.Vector3());
}

function mergeThreeBoxes(boxes: THREE.Box3[]) {
  const merged = boxes[0].clone();
  for (const box of boxes.slice(1)) merged.union(box);
  return merged;
}

function markerSphere(position: THREE.Vector3, color: number, radius: number) {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false }),
  );
  marker.position.copy(position);
  return marker;
}

function lineBetween(start: THREE.Vector3, end: THREE.Vector3, color: number) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start, end]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.78, depthTest: false }),
  );
}

function findTailWakePlot(report?: OpenFoamReport) {
  const plots = report?.variants?.flatMap((variant) => variant.vortexSections?.plots ?? []).filter(Boolean) ?? [];
  return plots.find((plot) => plot.plane === "tail_impact_yz") ?? plots.find((plot) => plot.plane === "after_prop_yz");
}

function openFoamVorticitySection(plot: VortexPlotData) {
  const group = new THREE.Group();
  const planeX = plot.point?.[0] ?? 0;
  const planeY = planeX;
  const ySpan = Math.max(plot.bounds.yMax - plot.bounds.yMin, 0.001);
  const zSpan = Math.max(plot.bounds.zMax - plot.bounds.zMin, 0.001);
  const maxAbsOmega = Math.max(plot.scale.maxAbsOmegaX, ...plot.samples.map((sample) => Math.abs(sample.omegaX)), 1);
  const planeGeometry = new THREE.PlaneGeometry(ySpan, zSpan, 1, 1);
  const planeMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
  planeMesh.position.set((plot.bounds.yMin + plot.bounds.yMax) / 2, planeY, (plot.bounds.zMin + plot.bounds.zMax) / 2);
  planeMesh.rotation.x = Math.PI / 2;
  group.add(planeMesh);

  const positions: number[] = [];
  const colors: number[] = [];
  for (const sample of plot.samples) {
    const intensity = clamp(Math.abs(sample.omegaX) / maxAbsOmega, 0, 1);
    if (intensity < 0.08) continue;
    const color = vorticityColor(sample.omegaX, maxAbsOmega);
    positions.push(sample.y, planeY, sample.z);
    colors.push(color.r, color.g, color.b);
  }
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  pointsGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const pointsMaterial = new THREE.PointsMaterial({
    vertexColors: true,
    size: Math.max(Math.min(ySpan, zSpan) * 0.035, 0.018),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(pointsGeometry, pointsMaterial));
  return group;
}

function vorticityColor(omegaX: number, maxAbsOmega: number) {
  const intensity = clamp(Math.abs(omegaX) / Math.max(maxAbsOmega, 0.001), 0, 1);
  const stops = [
    { t: 0, color: new THREE.Color("#164dff") },
    { t: 0.26, color: new THREE.Color("#00e5ff") },
    { t: 0.48, color: new THREE.Color("#42f54b") },
    { t: 0.68, color: new THREE.Color("#fff047") },
    { t: 0.84, color: new THREE.Color("#ff7a18") },
    { t: 1, color: new THREE.Color("#f01818") },
  ];
  for (let index = 1; index < stops.length; index += 1) {
    const lower = stops[index - 1];
    const upper = stops[index];
    if (intensity <= upper.t) {
      return lower.color.clone().lerp(upper.color, (intensity - lower.t) / Math.max(upper.t - lower.t, 0.001));
    }
  }
  return stops[stops.length - 1].color.clone();
}

function buildTailplaneSizingTest(project: SizingProject): TailplaneSizingTest {
  const hasWing = project.shapes.some((shape) => shape.role === "liftingSurface" && ((shape.liftingSurfaceKind ?? "wing") === "wing" || shape.liftingSurfaceKind === "wingevon"));
  const hasTailplane = project.shapes.some((shape) => shape.role === "liftingSurface" && shape.liftingSurfaceKind === "tailplane");
  const sourceProject = hasWing && hasTailplane ? project : { ...project, shapes: referenceTailplaneTestShapes() };
  const aero = computeSketchAerodynamics(sourceProject);
  const targetVolume = Number.isFinite(project.mission.tailVolumeTarget) ? project.mission.tailVolumeTarget : 0.55;
  const rawVolume = aero.stability.tailVolumeCoefficientRaw;
  const wakeQRatio = auditedSizingAssumptions.tailplaneDynamicPressureRatio;
  const allMovingFactor = auditedSizingAssumptions.tailplaneAllMovingAuthorityFactor;
  const authorityFactor = tailplaneAuthorityFactor();
  const wakeOnlyVolume = rawVolume * wakeQRatio;
  const effectiveVolume = aero.stability.tailVolumeCoefficient;
  const referenceDenominator = Math.max(aero.geometry.wingAreaM2 * aero.geometry.meanChordM, 0.01);
  const requiredAreaNoWakeM2 = aero.geometry.tailplaneArmM > 0 ? (targetVolume * referenceDenominator) / aero.geometry.tailplaneArmM : 0;
  const requiredAreaWithWakeM2 = authorityFactor > 0 ? requiredAreaNoWakeM2 / authorityFactor : requiredAreaNoWakeM2;
  return {
    source: hasWing && hasTailplane ? "Actual sketch" : "Reference test case",
    valid: aero.validity.tailVolume,
    targetVolume,
    rawVolume,
    wakeOnlyVolume,
    effectiveVolume,
    authorityFactor,
    wakeQRatio,
    allMovingFactor,
    marginPct: targetVolume > 0 ? ((effectiveVolume / targetVolume) - 1) * 100 : 0,
    freeStreamMarginPct: targetVolume > 0 ? ((rawVolume / targetVolume) - 1) * 100 : 0,
    wakeOnlyMarginPct: targetVolume > 0 ? ((wakeOnlyVolume / targetVolume) - 1) * 100 : 0,
    tailAreaM2: aero.geometry.tailplaneAreaM2,
    tailArmM: aero.geometry.tailplaneArmM,
    wingAreaM2: aero.geometry.wingAreaM2,
    meanChordM: aero.geometry.meanChordM,
    requiredAreaNoWakeM2,
    requiredAreaWithWakeM2,
    areaSavedByWakeM2: Math.max(0, requiredAreaNoWakeM2 - requiredAreaWithWakeM2),
  };
}

function referenceTailplaneTestShapes(): SizeShape[] {
  return [
    {
      id: "tail-test-wing",
      role: "liftingSurface",
      liftingSurfaceKind: "wing",
      label: "Test wing",
      drawMode: "line",
      bodyMaterial: "carbonFibre",
      bodyThicknessMm: 1.2,
      points: [
        { xM: 0, yM: 0.12 },
        { xM: 0.8, yM: 0.12 },
        { xM: 0.8, yM: -0.12 },
        { xM: 0, yM: -0.12 },
      ],
    },
    {
      id: "tail-test-rotor",
      role: "part",
      partType: "rotor",
      label: "Rotor wake",
      drawMode: "line",
      points: [
        { xM: 0.32, yM: -0.86 },
        { xM: 0.62, yM: -0.86 },
      ],
    },
    {
      id: "tail-test-tailplane",
      role: "liftingSurface",
      liftingSurfaceKind: "tailplane",
      label: "All-moving tail",
      drawMode: "line",
      airfoil: "NACA 0012",
      bodyMaterial: "carbonFibre",
      bodyThicknessMm: 1.2,
      points: [
        { xM: 0, yM: -0.82 },
        { xM: 0.34, yM: -0.82 },
        { xM: 0.34, yM: -0.96 },
        { xM: 0, yM: -0.96 },
      ],
    },
  ];
}

function JobButton({ disabled, icon, label, onClick, running }: { disabled: boolean; icon: ReactNode; label: string; onClick: () => void; running: boolean }) {
  return (
    <button className="openfoam-action" disabled={disabled} onClick={onClick} type="button">
      {running ? <RotateCcw className="spin" size={16} /> : icon}
      <span>{running ? "Running" : label}</span>
    </button>
  );
}

function OpenFoamCanvasShell({
  canvasClassName,
  children,
  fitClassName,
  mountRef,
  onFit,
  rootClassName,
}: {
  canvasClassName?: string;
  children?: ReactNode;
  fitClassName?: string;
  mountRef: RefObject<HTMLDivElement | null>;
  onFit: () => void;
  rootClassName: string;
}) {
  return (
    <div className={rootClassName}>
      <div className={canvasClassName} ref={mountRef} />
      <button aria-label="Zoom canvas to fit" className={["openfoam-fit-button", fitClassName].filter(Boolean).join(" ")} onClick={onFit} type="button">
        <Maximize2 size={15} />
        <span>Zoom to fit</span>
      </button>
      {children}
    </div>
  );
}

function PanelHeading({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="compute-group-heading">
      {icon}
      <h3>{title}</h3>
    </div>
  );
}

function OpenFoamPrepareMovementWorkspace({
  activeSurfaceCaptureId,
  geometryFingerprint,
  movementControls,
  onActiveSurfaceCaptureIdChange,
  onMovementControlsChange,
  onSurfaceStateCommit,
  onSurfaceCapturesChange,
  report,
  surfaceCaptures,
}: {
  activeSurfaceCaptureId: string | undefined;
  geometryFingerprint: string | undefined;
  movementControls: OpenFoamMovementControl[];
  onActiveSurfaceCaptureIdChange: (captureId: string | undefined) => void;
  onMovementControlsChange: (next: OpenFoamMovementControl[]) => void;
  onSurfaceStateCommit: (next: Partial<OpenFoamDashboardState>) => void;
  onSurfaceCapturesChange: (next: OpenFoamSurfaceCapture[]) => void;
  report: OpenFoamReport;
  surfaceCaptures: OpenFoamSurfaceCapture[];
}) {
  const candidates = useMemo(() => movementCandidateComponents(report), [report]);
  const firstConfiguredCandidate = movementControls.find((control) => candidates.some((component) => component.name === control.componentName))?.componentName;
  const [selectedComponentName, setSelectedComponentName] = useState(firstConfiguredCandidate ?? candidates[0]?.name ?? "");
  const [captureTitle, setCaptureTitle] = useState("");
  useEffect(() => {
    if (!candidates.length) {
      if (selectedComponentName) setSelectedComponentName("");
      return;
    }
    if (!selectedComponentName || !candidates.some((component) => component.name === selectedComponentName)) {
      setSelectedComponentName(firstConfiguredCandidate ?? candidates[0].name);
    }
  }, [candidates, firstConfiguredCandidate, selectedComponentName]);
  const selectedComponent = candidates.find((component) => component.name === selectedComponentName) ?? candidates[0];
  const savedSelectedControl = selectedComponent ? movementControls.find((control) => control.componentName === selectedComponent.name) : undefined;
  const selectedControl = selectedComponent ? savedSelectedControl ?? defaultMovementControl(selectedComponent, false) : undefined;
  const upsertControl = (patch: Partial<OpenFoamMovementControl>) => {
    if (!selectedComponent || !selectedControl) return;
    upsertControlForComponent(selectedComponent.name, patch);
  };
  const upsertControlForComponent = (componentName: string, patch: Partial<OpenFoamMovementControl>) => {
    const component = candidates.find((candidate) => candidate.name === componentName);
    if (!component) return;
    const currentControl = movementControls.find((control) => control.componentName === component.name) ?? defaultMovementControl(component, false);
    const nextControl = {
      ...currentControl,
      ...patch,
      componentName: component.name,
      componentKind: component.kind,
      label: component.label,
      enabled: patch.enabled ?? currentControl.enabled ?? true,
    };
    onMovementControlsChange([
      ...movementControls.filter((control) => control.componentName !== component.name),
      nextControl,
    ]);
  };
  const removeControl = () => {
    if (!selectedComponent) return;
    onMovementControlsChange(movementControls.filter((control) => control.componentName !== selectedComponent.name));
  };
  const captureSurfaceSetup = () => {
    const createdAt = Date.now();
    const title = captureTitle.trim() || `Surface setup ${surfaceCaptures.length + 1}`;
    const capture: OpenFoamSurfaceCapture = {
      id: `surface-${createdAt.toString(36)}`,
      title,
      geometryFingerprint,
      createdAt,
      componentCount: report.preview?.components.length,
      movementControls: cloneMovementControls(movementControls.filter((control) => control.enabled)),
    };
    const nextSurfaceCaptures = [...surfaceCaptures, capture];
    onSurfaceCapturesChange(nextSurfaceCaptures);
    onActiveSurfaceCaptureIdChange(capture.id);
    onSurfaceStateCommit({
      activeSurfaceCaptureId: capture.id,
      movementControls,
      surfaceCaptures: nextSurfaceCaptures,
    });
    setCaptureTitle("");
  };
  const useSurfaceCapture = (capture: OpenFoamSurfaceCapture) => {
    const nextMovementControls = cloneMovementControls(capture.movementControls);
    onMovementControlsChange(nextMovementControls);
    onActiveSurfaceCaptureIdChange(capture.id);
    onSurfaceStateCommit({
      activeSurfaceCaptureId: capture.id,
      movementControls: nextMovementControls,
      surfaceCaptures,
    });
  };
  const deleteSurfaceCapture = (captureId: string) => {
    const nextSurfaceCaptures = surfaceCaptures.filter((capture) => capture.id !== captureId);
    const nextActiveSurfaceCaptureId = activeSurfaceCaptureId === captureId ? undefined : activeSurfaceCaptureId;
    onSurfaceCapturesChange(nextSurfaceCaptures);
    if (activeSurfaceCaptureId === captureId) onActiveSurfaceCaptureIdChange(undefined);
    onSurfaceStateCommit({
      activeSurfaceCaptureId: nextActiveSurfaceCaptureId,
      movementControls,
      surfaceCaptures: nextSurfaceCaptures,
    });
  };

  return (
    <div className="openfoam-prepare-workspace">
      <div className="openfoam-prepare-canvas-panel">
        <OpenFoamMovementCanvas
          movementControls={movementControls}
          onHingeChange={upsertControlForComponent}
          onSelectComponent={setSelectedComponentName}
          report={report}
          selectedComponentName={selectedComponent?.name}
        />
        <div className="openfoam-foam-output">
          <strong>FOAM output</strong>
          <span>{report.preview?.components.length ?? 0} exported surface groups prepared</span>
          <code>{report.geometryDir}</code>
        </div>
      </div>
      <OpenFoamMovementEditor
        activeSurfaceCaptureId={activeSurfaceCaptureId}
        captureTitle={captureTitle}
        candidates={candidates}
        control={selectedControl}
        configuredCount={movementControls.filter((control) => candidates.some((component) => component.name === control.componentName)).length}
        onCapture={captureSurfaceSetup}
        onCaptureTitleChange={setCaptureTitle}
        onDeleteCapture={deleteSurfaceCapture}
        onPatch={upsertControl}
        onRemove={removeControl}
        onSelect={setSelectedComponentName}
        onUseCapture={useSurfaceCapture}
        selectedComponent={selectedComponent}
        surfaceCaptures={surfaceCaptures}
      />
    </div>
  );
}

function movementCandidateComponents(report: OpenFoamReport) {
  return (report.preview?.components ?? []).filter((component) => component.kind === "wingevon" || component.kind === "tailplane" || component.kind === "fin");
}

function defaultMovementControl(component: OpenFoamPreviewComponent, enabled = true): OpenFoamMovementControl {
  const isFin = component.kind === "fin";
  const isWingevon = component.kind === "wingevon";
  return {
    componentName: component.name,
    componentKind: component.kind,
    label: component.label,
    axis: isFin ? "vertical-hinge" : "span-hinge",
    deflectionDeg: 0,
    minDeg: isWingevon ? -25 : -20,
    maxDeg: isWingevon ? 25 : 20,
    neutralDeg: 0,
    hingeChordFraction: 0.25,
    hingeSpanFraction: 0.5,
    hingeVerticalFraction: 0.5,
    enabled,
  };
}

function cloneMovementControls(controls: OpenFoamMovementControl[]) {
  return controls.map((control) => ({ ...control }));
}

function OpenFoamMovementEditor({
  activeSurfaceCaptureId,
  captureTitle,
  candidates,
  configuredCount,
  control,
  onCapture,
  onCaptureTitleChange,
  onDeleteCapture,
  onPatch,
  onRemove,
  onSelect,
  onUseCapture,
  selectedComponent,
  surfaceCaptures,
}: {
  activeSurfaceCaptureId: string | undefined;
  captureTitle: string;
  candidates: OpenFoamPreviewComponent[];
  configuredCount: number;
  control: OpenFoamMovementControl | undefined;
  onCapture: () => void;
  onCaptureTitleChange: (title: string) => void;
  onDeleteCapture: (captureId: string) => void;
  onPatch: (patch: Partial<OpenFoamMovementControl>) => void;
  onRemove: () => void;
  onSelect: (componentName: string) => void;
  onUseCapture: (capture: OpenFoamSurfaceCapture) => void;
  selectedComponent: OpenFoamPreviewComponent | undefined;
  surfaceCaptures: OpenFoamSurfaceCapture[];
}) {
  if (!candidates.length || !selectedComponent || !control) {
    return (
      <aside className="openfoam-movement-panel">
        <strong>Movable parts</strong>
        <span>No wingevons, tailplanes, or fins were found in the prepared geometry.</span>
      </aside>
    );
  }
  return (
    <aside className="openfoam-movement-panel">
      <div className="openfoam-movement-panel-head">
        <div>
          <strong>Movable parts</strong>
          <span>{configuredCount} configured</span>
        </div>
      </div>
      <label className="openfoam-movement-field">
        <span>Selected part</span>
        <select value={selectedComponent.name} onChange={(event) => onSelect(event.target.value)}>
          {candidates.map((component) => (
            <option key={component.name} value={component.name}>
              {component.label ?? component.name}
            </option>
          ))}
        </select>
      </label>
      <label className="openfoam-movement-check">
        <input checked={control.enabled} onChange={(event) => onPatch({ enabled: event.target.checked })} type="checkbox" />
        <span>Enable movement</span>
      </label>
      <label className="openfoam-movement-field">
        <span>Movement axis</span>
        <select value={control.axis} onChange={(event) => onPatch({ axis: event.target.value as OpenFoamMovementAxis })}>
          <option value="span-hinge">Span hinge</option>
          <option value="vertical-hinge">Vertical hinge</option>
          <option value="chord-hinge">Chord hinge</option>
        </select>
      </label>
      <div className="openfoam-movement-field-row">
        <label className="openfoam-movement-field">
          <span>Min deg</span>
          <input type="number" value={control.minDeg} onChange={(event) => onPatch({ minDeg: Number(event.target.value) })} />
        </label>
        <label className="openfoam-movement-field">
          <span>Max deg</span>
          <input type="number" value={control.maxDeg} onChange={(event) => onPatch({ maxDeg: Number(event.target.value) })} />
        </label>
      </div>
      <div className="openfoam-movement-field-row">
        <label className="openfoam-movement-field">
          <span>Scene deflection</span>
          <input
            type="number"
            value={control.deflectionDeg ?? 0}
            onChange={(event) => onPatch({ deflectionDeg: clamp(Number(event.target.value), control.minDeg, control.maxDeg) })}
          />
        </label>
        <label className="openfoam-movement-field">
          <span>Neutral deg</span>
          <input type="number" value={control.neutralDeg} onChange={(event) => onPatch({ neutralDeg: Number(event.target.value) })} />
        </label>
      </div>
      <div className="openfoam-movement-field-row">
        <label className="openfoam-movement-field">
          <span>Hinge % chord</span>
          <input
            max={100}
            min={0}
            step={5}
            type="number"
            value={Math.round(control.hingeChordFraction * 100)}
            onChange={(event) => onPatch({ hingeChordFraction: clamp(Number(event.target.value) / 100, 0, 1) })}
          />
        </label>
        <label className="openfoam-movement-field">
          <span>Hinge span %</span>
          <input
            max={100}
            min={0}
            step={5}
            type="number"
            value={Math.round(control.hingeSpanFraction * 100)}
            onChange={(event) => onPatch({ hingeSpanFraction: clamp(Number(event.target.value) / 100, 0, 1) })}
          />
        </label>
      </div>
      <div className="openfoam-movement-field-row">
        <label className="openfoam-movement-field">
          <span>Hinge height %</span>
          <input
            max={100}
            min={0}
            step={5}
            type="number"
            value={Math.round(control.hingeVerticalFraction * 100)}
            onChange={(event) => onPatch({ hingeVerticalFraction: clamp(Number(event.target.value) / 100, 0, 1) })}
          />
        </label>
        <div className="openfoam-movement-field openfoam-movement-field-note">
          <span>Pose handle</span>
          <strong>Drag orange</strong>
        </div>
      </div>
      <div className="openfoam-movement-summary">
        <span>{axisDescription(control.axis)}</span>
        <span>Drag green to place the hinge. Drag orange to pose the part before Capture.</span>
        <strong>{formatSigned(control.minDeg, 0)} to {formatSigned(control.maxDeg, 0)} deg</strong>
      </div>
      <button className="openfoam-movement-remove" onClick={onRemove} type="button">Clear movement</button>
      <div className="openfoam-capture-box">
        <div>
          <strong>Surface captures</strong>
          <span>Named prepared-surface states for later cases.</span>
        </div>
        <label className="openfoam-movement-field">
          <span>Capture title</span>
          <input
            placeholder={`Surface setup ${surfaceCaptures.length + 1}`}
            type="text"
            value={captureTitle}
            onChange={(event) => onCaptureTitleChange(event.target.value)}
          />
        </label>
        <button className="openfoam-capture-button" onClick={onCapture} type="button">Capture</button>
        {surfaceCaptures.length ? (
          <div className="openfoam-capture-list">
            {surfaceCaptures.map((capture) => (
              <div className={["openfoam-capture-item", capture.id === activeSurfaceCaptureId ? "active" : ""].filter(Boolean).join(" ")} key={capture.id}>
                <button onClick={() => onUseCapture(capture)} type="button">
                  <strong>{capture.title}</strong>
                  <span>{capture.movementControls.length} moving surfaces</span>
                </button>
                <button aria-label={`Delete ${capture.title}`} className="openfoam-capture-delete" onClick={() => onDeleteCapture(capture.id)} type="button">Delete</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function axisDescription(axis: OpenFoamMovementAxis) {
  if (axis === "vertical-hinge") return "Yaw-style rotation around a vertical hinge.";
  if (axis === "chord-hinge") return "Roll-style rotation around the chord direction.";
  return "Pitch-style rotation around the span direction.";
}

function OpenFoamMovementCanvas({
  movementControls,
  onHingeChange,
  onSelectComponent,
  report,
  selectedComponentName,
}: {
  movementControls: OpenFoamMovementControl[];
  onHingeChange: (componentName: string, patch: Partial<OpenFoamMovementControl>) => void;
  onSelectComponent: (componentName: string) => void;
  report: OpenFoamReport;
  selectedComponentName: string | undefined;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const panOffsetRef = useRef(new THREE.Vector3());
  const rotationRef = useRef(new THREE.Quaternion());
  const zoomRef = useRef(1);
  const onHingeChangeRef = useRef(onHingeChange);
  const [viewResetCount, setViewResetCount] = useState(0);

  useEffect(() => {
    onHingeChangeRef.current = onHingeChange;
  }, [onHingeChange]);

  useEffect(() => {
    const mount = mountRef.current;
    const components = report.preview?.components ?? [];
    if (!mount || !components.length) return undefined;

    const width = Math.max(mount.clientWidth, 420);
    const height = 430;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.domElement.style.background = "transparent";
    mount.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 200);
    camera.up.set(0, 0, 1);
    const group = new THREE.Group();
    scene.add(group);

    const selectableMeshes: THREE.Mesh[] = [];
    const controlMap = new Map(movementControls.map((control) => [control.componentName, control]));
    let selectedMesh: THREE.Mesh | undefined;
    let selectedControlForHinge: OpenFoamMovementControl | undefined;
    let selectedHingeBox: THREE.Box3 | undefined;
    let selectedComponentGroup: THREE.Group | undefined;
    let hingeLine: THREE.Line | undefined;
    let hingeHandle: THREE.Mesh | undefined;
    let poseHandle: THREE.Mesh | undefined;
    for (const component of components) {
      const positions: number[] = [];
      for (const tri of component.triangles) {
        for (const point of tri) positions.push(point[1], point[0], point[2]);
      }
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const componentBox = geometry.boundingBox?.clone();
      const isCandidate = component.kind === "wingevon" || component.kind === "tailplane" || component.kind === "fin";
      const isSelected = component.name === selectedComponentName;
      const configured = controlMap.has(component.name);
      const control = controlMap.get(component.name);
      const componentGroup = new THREE.Group();
      componentGroup.name = `${component.name}_pose`;
      const material = new THREE.MeshStandardMaterial({
        color: isSelected ? new THREE.Color("#facc15") : configured ? new THREE.Color("#86efac") : new THREE.Color(component.color),
        emissive: isSelected ? new THREE.Color("#3f2a05") : new THREE.Color("#000000"),
        metalness: 0.04,
        roughness: 0.68,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = component.name;
      mesh.userData.componentName = component.name;
      mesh.userData.componentKind = component.kind;
      componentGroup.add(mesh);
      if (isCandidate) selectableMeshes.push(mesh);
      if (isSelected) {
        selectedMesh = mesh;
        selectedComponentGroup = componentGroup;
      }
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 24),
        new THREE.LineBasicMaterial({ color: isSelected ? 0xfef08a : 0xdbeafe, transparent: true, opacity: isCandidate ? 0.62 : 0.32, depthWrite: false }),
      );
      edges.renderOrder = isCandidate ? 3 : 2;
      componentGroup.add(edges);
      if (isSelected && componentBox) {
        poseHandle = movementPoseHandleForBox(componentBox, control ?? defaultMovementControl(component, false));
        componentGroup.add(poseHandle);
      }
      if (componentBox && control?.enabled) applyHingePoseToObject(componentGroup, componentBox, control);
      group.add(componentGroup);
    }

    if (selectedMesh) {
      selectedControlForHinge = controlMap.get(selectedMesh.name) ?? defaultMovementControl({
        name: selectedMesh.name,
        kind: selectedMesh.userData.componentKind,
        label: selectedMesh.name,
        color: "#facc15",
        triangles: [],
      }, false);
      const hingeVisual = movementHingeVisualForMesh(selectedMesh, selectedControlForHinge);
      if (hingeVisual) {
        selectedHingeBox = hingeVisual.box;
        hingeLine = hingeVisual.line;
        hingeHandle = hingeVisual.handle;
        group.add(hingeLine, hingeHandle);
      }
    }

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    group.position.sub(center);
    group.position.add(panOffsetRef.current);
    group.quaternion.copy(rotationRef.current);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const cameraBasePosition = openFoamDefaultCameraPosition(maxDim);
    const applyZoom = (nextZoom = zoomRef.current) => {
      const cameraScale = 1 / nextZoom;
      camera.position.copy(cameraBasePosition).multiplyScalar(cameraScale);
      camera.lookAt(0, 0, 0);
    };
    const updateZoom = (nextZoom: number) => {
      zoomRef.current = clamp(nextZoom, 0.6, 4);
      applyZoom();
    };
    applyZoom();

    scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x17252e, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4, -5, 5);
    scene.add(key);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = maxDim * 0.025;
    const pointer = new THREE.Vector2();
    let animationFrame = 0;
    let dragging = false;
    let draggingHinge = false;
    let draggingPose = false;
    let panning = false;
    let moved = false;
    let startPointer = { x: 0, y: 0 };
    let lastPointer = { x: 0, y: 0 };
    let lastTrackballPoint = new THREE.Vector3();
    let hingeDragPlane: THREE.Plane | undefined;
    let pendingHingePatch: Partial<OpenFoamMovementControl> | undefined;
    let pendingPosePatch: Partial<OpenFoamMovementControl> | undefined;
    let poseStartDeflection = 0;
    const setPointerFromEvent = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const projectToTrackball = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const radius = Math.max(Math.min(rect.width, rect.height) * 0.5, 1);
      const x = (event.clientX - rect.left - rect.width * 0.5) / radius;
      const y = (rect.height * 0.5 - (event.clientY - rect.top)) / radius;
      const lengthSq = x * x + y * y;
      if (lengthSq <= 1) return new THREE.Vector3(x, y, Math.sqrt(1 - lengthSq)).normalize();
      return new THREE.Vector3(x, y, 0).normalize();
    };
    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      setPointerFromEvent(event);
      const poseHit = poseHandle ? raycaster.intersectObject(poseHandle, false)[0] : undefined;
      if (poseHit && selectedMesh && selectedControlForHinge && selectedHingeBox && selectedComponentGroup) {
        dragging = true;
        draggingPose = true;
        moved = true;
        pendingPosePatch = undefined;
        poseStartDeflection = selectedControlForHinge.deflectionDeg ?? 0;
        startPointer = { x: event.clientX, y: event.clientY };
        lastPointer = startPointer;
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }
      const handleHit = hingeHandle ? raycaster.intersectObject(hingeHandle, false)[0] : undefined;
      if (handleHit && selectedMesh && selectedControlForHinge && selectedHingeBox && hingeLine && hingeHandle) {
        dragging = true;
        draggingHinge = true;
        moved = true;
        pendingHingePatch = undefined;
        startPointer = { x: event.clientX, y: event.clientY };
        lastPointer = startPointer;
        const handleWorld = hingeHandle.getWorldPosition(new THREE.Vector3());
        const cameraNormal = camera.getWorldDirection(new THREE.Vector3());
        hingeDragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraNormal, handleWorld);
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }
      dragging = true;
      moved = false;
      panning = event.shiftKey || event.button === 1 || event.button === 2;
      startPointer = { x: event.clientX, y: event.clientY };
      lastPointer = startPointer;
      lastTrackballPoint = projectToTrackball(event);
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      event.preventDefault();
      if (draggingPose) {
        moved = true;
        if (selectedControlForHinge && selectedHingeBox && selectedComponentGroup) {
          const deltaDeg = (event.clientX - startPointer.x) * 0.18 - (event.clientY - startPointer.y) * 0.28;
          const deflectionDeg = clamp(poseStartDeflection + deltaDeg, selectedControlForHinge.minDeg, selectedControlForHinge.maxDeg);
          pendingPosePatch = { deflectionDeg };
          selectedControlForHinge = { ...selectedControlForHinge, deflectionDeg, enabled: true };
          applyHingePoseToObject(selectedComponentGroup, selectedHingeBox, selectedControlForHinge);
        }
        return;
      }
      if (draggingHinge) {
        moved = true;
        if (hingeDragPlane && selectedControlForHinge && selectedHingeBox && hingeLine && hingeHandle) {
          setPointerFromEvent(event);
          const worldPoint = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(hingeDragPlane, worldPoint)) {
            const localPoint = group.worldToLocal(worldPoint.clone());
            pendingHingePatch = hingePatchFromLocalPoint(selectedHingeBox, selectedControlForHinge.axis, localPoint);
            const previewControl = { ...selectedControlForHinge, ...pendingHingePatch };
            updateHingeVisual(hingeLine, hingeHandle, selectedHingeBox, previewControl);
          }
        }
        return;
      }
      if (Math.hypot(event.clientX - startPointer.x, event.clientY - startPointer.y) > 4) moved = true;
      if (panning) {
        const dx = event.clientX - lastPointer.x;
        const dy = event.clientY - lastPointer.y;
        const panScale = (maxDim * 0.0022) / zoomRef.current;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(dx * panScale);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dy * panScale);
        const delta = right.add(up);
        group.position.add(delta);
        panOffsetRef.current.add(delta);
        lastPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      const nextTrackballPoint = projectToTrackball(event);
      const axis = new THREE.Vector3().crossVectors(lastTrackballPoint, nextTrackballPoint);
      const axisLength = axis.length();
      if (axisLength > 1e-5) {
        axis.normalize().applyQuaternion(camera.quaternion).normalize();
        const angle = Math.atan2(axisLength, lastTrackballPoint.dot(nextTrackballPoint));
        group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
        rotationRef.current.copy(group.quaternion);
      }
      lastTrackballPoint = nextTrackballPoint;
    };
    const selectFromPointer = (event: PointerEvent) => {
      setPointerFromEvent(event);
      const hit = raycaster.intersectObjects(selectableMeshes, false)[0];
      if (hit?.object instanceof THREE.Mesh) onSelectComponent(String(hit.object.userData.componentName));
    };
    const onPointerUp = (event: PointerEvent) => {
      if (draggingPose) {
        if (selectedMesh && pendingPosePatch) onHingeChangeRef.current(selectedMesh.name, { ...pendingPosePatch, enabled: true });
        dragging = false;
        draggingPose = false;
        pendingPosePatch = undefined;
        if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
        return;
      }
      if (draggingHinge) {
        if (selectedMesh && pendingHingePatch) onHingeChangeRef.current(selectedMesh.name, pendingHingePatch);
        dragging = false;
        draggingHinge = false;
        pendingHingePatch = undefined;
        hingeDragPlane = undefined;
        if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
        return;
      }
      if (!moved) selectFromPointer(event);
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const onPointerCancel = (event: PointerEvent) => {
      dragging = false;
      draggingHinge = false;
      draggingPose = false;
      pendingHingePatch = undefined;
      pendingPosePatch = undefined;
      hingeDragPlane = undefined;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        updateZoom(zoomRef.current * openFoamWheelZoomMultiplier(event.deltaY));
        return;
      }
      const panScale = (maxDim * 0.0018) / zoomRef.current;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(-event.deltaX * panScale);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(event.deltaY * panScale);
      const delta = right.add(up);
      group.position.add(delta);
      panOffsetRef.current.add(delta);
    };
    let gestureBaseZoom = zoomRef.current;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureBaseZoom = zoomRef.current;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = typeof (event as Event & { scale?: number }).scale === "number" ? (event as Event & { scale: number }).scale : 1;
      updateZoom(gestureBaseZoom * openFoamGestureZoomScale(scale));
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    renderer.domElement.addEventListener("pointerleave", onPointerCancel);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("gesturestart", onGestureStart);
    renderer.domElement.addEventListener("gesturechange", onGestureChange);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const render = () => {
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      rotationRef.current.copy(group.quaternion);
      window.cancelAnimationFrame(animationFrame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("pointerleave", onPointerCancel);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("gesturestart", onGestureStart);
      renderer.domElement.removeEventListener("gesturechange", onGestureChange);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      mount.replaceChildren();
    };
  }, [movementControls, onSelectComponent, report, selectedComponentName, viewResetCount]);

  return (
    <OpenFoamCanvasShell
      canvasClassName="openfoam-movement-canvas"
      mountRef={mountRef}
      rootClassName="openfoam-movement-canvas-shell"
      onFit={() => {
        panOffsetRef.current.set(0, 0, 0);
        rotationRef.current.identity();
        zoomRef.current = 1;
        setViewResetCount((current) => current + 1);
      }}
    />
  );
}

function movementHingeVisualForMesh(mesh: THREE.Mesh, control: OpenFoamMovementControl) {
  const box = meshGeometryBox(mesh);
  if (!box) return undefined;
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(movementHingeLinePoints(box, control)),
    new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.95, depthTest: false }),
  );
  line.renderOrder = 20;
  const size = box.getSize(new THREE.Vector3());
  const handleRadius = Math.max(size.length() * 0.045, 0.035);
  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(handleRadius, 24, 16),
    new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x0b3b1d,
      metalness: 0,
      roughness: 0.35,
      depthTest: false,
    }),
  );
  handle.name = "hinge-location-handle";
  handle.renderOrder = 30;
  handle.position.copy(movementHingeHandlePoint(box, control));
  return { box, line, handle };
}

function movementPoseHandleForBox(box: THREE.Box3, control: OpenFoamMovementControl) {
  const size = box.getSize(new THREE.Vector3());
  const handleRadius = Math.max(size.length() * 0.055, 0.045);
  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(handleRadius, 24, 16),
    new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0x4a1d04,
      metalness: 0,
      roughness: 0.32,
      depthTest: false,
    }),
  );
  handle.name = "part-pose-handle";
  handle.renderOrder = 35;
  handle.position.copy(movementPoseHandlePoint(box, control));
  return handle;
}

function meshGeometryBox(mesh: THREE.Mesh) {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  geometry.computeBoundingBox();
  return geometry.boundingBox?.clone();
}

function movementPoseHandlePoint(box: THREE.Box3, control: OpenFoamMovementControl) {
  const size = box.getSize(new THREE.Vector3());
  const hinge = movementHingeHandlePoint(box, control);
  const center = box.getCenter(new THREE.Vector3());
  if (control.axis === "vertical-hinge") {
    const oppositeX = hinge.x < center.x ? box.max.x : box.min.x;
    const oppositeY = hinge.y < center.y ? box.max.y : box.min.y;
    return new THREE.Vector3(oppositeX, oppositeY, center.z);
  }
  if (control.axis === "chord-hinge") {
    const oppositeX = hinge.x < center.x ? box.max.x : box.min.x;
    const oppositeZ = hinge.z < center.z ? box.max.z : box.min.z;
    return new THREE.Vector3(oppositeX, center.y, oppositeZ);
  }
  const oppositeY = hinge.y < center.y ? box.max.y : box.min.y;
  const oppositeZ = hinge.z < center.z ? box.max.z : box.min.z;
  return new THREE.Vector3(center.x, oppositeY, size.z < 0.001 ? center.z : oppositeZ);
}

function movementHingeHandlePoint(box: THREE.Box3, control: OpenFoamMovementControl) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const spanX = box.min.x + size.x * clamp(control.hingeSpanFraction ?? 0.5, 0, 1);
  const chordY = box.max.y - size.y * clamp(control.hingeChordFraction ?? 0.25, 0, 1);
  const verticalZ = box.min.z + size.z * clamp(control.hingeVerticalFraction ?? 0.5, 0, 1);
  if (control.axis === "vertical-hinge") return new THREE.Vector3(spanX, chordY, center.z);
  if (control.axis === "chord-hinge") return new THREE.Vector3(spanX, center.y, verticalZ);
  return new THREE.Vector3(center.x, chordY, verticalZ);
}

function movementHingeLinePoints(box: THREE.Box3, control: OpenFoamMovementControl): [THREE.Vector3, THREE.Vector3] {
  const size = box.getSize(new THREE.Vector3());
  const point = movementHingeHandlePoint(box, control);
  const pad = Math.max(size.length() * 0.18, 0.06);
  if (control.axis === "vertical-hinge") {
    return [
      new THREE.Vector3(point.x, point.y, box.min.z - pad),
      new THREE.Vector3(point.x, point.y, box.max.z + pad),
    ];
  }
  if (control.axis === "chord-hinge") {
    return [
      new THREE.Vector3(point.x, box.min.y - pad, point.z),
      new THREE.Vector3(point.x, box.max.y + pad, point.z),
    ];
  }
  return [
    new THREE.Vector3(box.min.x - pad, point.y, point.z),
    new THREE.Vector3(box.max.x + pad, point.y, point.z),
  ];
}

function updateHingeVisual(line: THREE.Line, handle: THREE.Mesh, box: THREE.Box3, control: OpenFoamMovementControl) {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(movementHingeLinePoints(box, control));
  handle.position.copy(movementHingeHandlePoint(box, control));
}

function applyHingePoseToObject(object: THREE.Object3D, box: THREE.Box3, control: OpenFoamMovementControl) {
  object.matrixAutoUpdate = false;
  object.matrix.identity();
  object.matrix.copy(hingePoseMatrix(box, control));
  object.matrixWorldNeedsUpdate = true;
}

function hingePoseMatrix(box: THREE.Box3, control: OpenFoamMovementControl) {
  const pivot = movementHingeHandlePoint(box, control);
  const axis = movementAxisVector(control.axis);
  const angle = ((control.deflectionDeg ?? 0) * Math.PI) / 180;
  return new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, angle))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

function movementAxisVector(axis: OpenFoamMovementAxis) {
  if (axis === "vertical-hinge") return new THREE.Vector3(0, 0, 1);
  if (axis === "chord-hinge") return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(1, 0, 0);
}

function hingePatchFromLocalPoint(box: THREE.Box3, axis: OpenFoamMovementAxis, point: THREE.Vector3): Partial<OpenFoamMovementControl> {
  const size = box.getSize(new THREE.Vector3());
  const safeX = Math.max(size.x, 1e-6);
  const safeY = Math.max(size.y, 1e-6);
  const safeZ = Math.max(size.z, 1e-6);
  const hingeSpanFraction = clamp((point.x - box.min.x) / safeX, 0, 1);
  const hingeChordFraction = clamp((box.max.y - point.y) / safeY, 0, 1);
  const hingeVerticalFraction = clamp((point.z - box.min.z) / safeZ, 0, 1);
  if (axis === "vertical-hinge") return { hingeSpanFraction, hingeChordFraction };
  if (axis === "chord-hinge") return { hingeSpanFraction, hingeVerticalFraction };
  return { hingeChordFraction, hingeVerticalFraction };
}

function OpenFoamMeshPreview({ report }: { report: OpenFoamReport }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const panOffsetRef = useRef(new THREE.Vector3());
  const zoomRef = useRef(1);
  const [viewResetCount, setViewResetCount] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    const components = report.preview?.components ?? [];
    if (!mount || !components.length) return undefined;

    const width = Math.max(mount.clientWidth, 320);
    const height = 380;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071018);
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 200);
    camera.up.set(0, 0, 1);
    const group = new THREE.Group();
    scene.add(group);

    for (const component of components) {
      const positions: number[] = [];
      for (const tri of component.triangles) {
        for (const point of tri) positions.push(point[1], point[0], point[2]);
      }
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(component.color),
        metalness: 0.05,
        roughness: 0.72,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = component.name;
      group.add(mesh);
    }

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    group.position.sub(center);
    group.position.add(panOffsetRef.current);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const cameraBasePosition = openFoamDefaultCameraPosition(maxDim);
    const applyZoom = (nextZoom = zoomRef.current) => {
      const cameraScale = 1 / nextZoom;
      camera.position.copy(cameraBasePosition).multiplyScalar(cameraScale);
      camera.lookAt(0, 0, 0);
    };
    const updateZoom = (nextZoom: number) => {
      zoomRef.current = clamp(nextZoom, 0.6, 4);
      applyZoom();
    };
    applyZoom();

    scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x17252e, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4, -5, 5);
    scene.add(key);

    let animationFrame = 0;
    let dragging = false;
    let panning = false;
    let lastPointer = { x: 0, y: 0 };
    let lastTrackballPoint = new THREE.Vector3();
    const projectToTrackball = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const radius = Math.max(Math.min(rect.width, rect.height) * 0.5, 1);
      const x = (event.clientX - rect.left - rect.width * 0.5) / radius;
      const y = (rect.height * 0.5 - (event.clientY - rect.top)) / radius;
      const lengthSq = x * x + y * y;
      if (lengthSq <= 1) return new THREE.Vector3(x, y, Math.sqrt(1 - lengthSq)).normalize();
      return new THREE.Vector3(x, y, 0).normalize();
    };
    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      dragging = true;
      panning = event.shiftKey || event.button === 1 || event.button === 2;
      lastPointer = { x: event.clientX, y: event.clientY };
      lastTrackballPoint = projectToTrackball(event);
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      event.preventDefault();
      if (panning) {
        const dx = event.clientX - lastPointer.x;
        const dy = event.clientY - lastPointer.y;
        const panScale = (maxDim * 0.0022) / zoomRef.current;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(dx * panScale);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dy * panScale);
        const delta = right.add(up);
        group.position.add(delta);
        panOffsetRef.current.add(delta);
        lastPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      const nextTrackballPoint = projectToTrackball(event);
      const axis = new THREE.Vector3().crossVectors(lastTrackballPoint, nextTrackballPoint);
      const axisLength = axis.length();
      if (axisLength > 1e-5) {
        axis.normalize().applyQuaternion(camera.quaternion).normalize();
        const angle = Math.atan2(axisLength, lastTrackballPoint.dot(nextTrackballPoint));
        group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      }
      lastTrackballPoint = nextTrackballPoint;
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const onPointerCancel = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    renderer.domElement.addEventListener("pointerleave", onPointerCancel);
    const onContextMenu = (event: Event) => event.preventDefault();
    let gestureBaseZoom = zoomRef.current;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        updateZoom(zoomRef.current * openFoamWheelZoomMultiplier(event.deltaY));
        return;
      }
      const panScale = (maxDim * 0.0018) / zoomRef.current;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(-event.deltaX * panScale);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(event.deltaY * panScale);
      const delta = right.add(up);
      group.position.add(delta);
      panOffsetRef.current.add(delta);
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureBaseZoom = zoomRef.current;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = typeof (event as Event & { scale?: number }).scale === "number" ? (event as Event & { scale: number }).scale : 1;
      updateZoom(gestureBaseZoom * openFoamGestureZoomScale(scale));
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("gesturestart", onGestureStart);
    renderer.domElement.addEventListener("gesturechange", onGestureChange);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const render = () => {
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("pointerleave", onPointerCancel);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("gesturestart", onGestureStart);
      renderer.domElement.removeEventListener("gesturechange", onGestureChange);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.dispose();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      mount.replaceChildren();
    };
  }, [report, viewResetCount]);

  const componentCount = report.preview?.components.length ?? 0;
  return (
    <div className="openfoam-preview-shell">
      <OpenFoamCanvasShell
        canvasClassName="openfoam-preview-canvas"
        mountRef={mountRef}
        rootClassName="openfoam-preview"
        onFit={() => {
            panOffsetRef.current.set(0, 0, 0);
            zoomRef.current = 1;
            setViewResetCount((current) => current + 1);
        }}
      >
        {componentCount ? null : <span className="openfoam-preview-empty">Run Prepare Geometry to load exported OpenFOAM surfaces.</span>}
      </OpenFoamCanvasShell>
      <div className="openfoam-preview-meta">
        <span>{componentCount} exported surface groups</span>
        <span>{report.geometryDir}</span>
      </div>
    </div>
  );
}

type LexRow = {
  alphaDeg: number;
  cleanCL: number;
  lexCL: number;
  deltaCL: number;
  wingDeltaCL: number;
  bodyDeltaCL: number;
  lexSelfCL: number;
};

function buildLexRows(report: OpenFoamReport | undefined): LexRow[] {
  const variants = report?.variants ?? [];
  const alphaValues = [...new Set(variants.map((variant) => variant.reference?.alphaDeg).filter((value): value is number => typeof value === "number"))].sort((a, b) => a - b);
  return alphaValues.flatMap((alphaDeg) => {
    const clean = variants.find((variant) => variant.id === `clean_alpha${alphaDeg}`);
    const lex = variants.find((variant) => variant.id === `lex_alpha${alphaDeg}`);
    if (!clean?.result || !lex?.result) return [];
    return [{
      alphaDeg,
      cleanCL: clean.result.CL,
      lexCL: lex.result.CL,
      deltaCL: lex.result.CL - clean.result.CL,
      wingDeltaCL: (lex.surfaceResults?.wing?.CL ?? 0) - (clean.surfaceResults?.wing?.CL ?? 0),
      bodyDeltaCL: (lex.surfaceResults?.body?.CL ?? 0) - (clean.surfaceResults?.body?.CL ?? 0),
      lexSelfCL: lex.surfaceResults?.lex?.CL ?? 0,
    }];
  });
}

function OpenFoamChart({ rows }: { rows: LexRow[] }) {
  const maxCL = Math.max(...rows.flatMap((row) => [row.cleanCL, row.lexCL]), 1);
  const minAlpha = Math.min(...rows.map((row) => row.alphaDeg));
  const maxAlpha = Math.max(...rows.map((row) => row.alphaDeg));
  const xFor = (alpha: number) => 36 + ((alpha - minAlpha) / Math.max(maxAlpha - minAlpha, 1)) * 308;
  const yFor = (cl: number) => 164 - (cl / maxCL) * 126;
  const cleanPoints = rows.map((row) => `${xFor(row.alphaDeg)},${yFor(row.cleanCL)}`).join(" ");
  const lexPoints = rows.map((row) => `${xFor(row.alphaDeg)},${yFor(row.lexCL)}`).join(" ");
  return (
    <svg className="openfoam-chart" role="img" viewBox="0 0 380 190">
      <line x1="36" x2="354" y1="164" y2="164" />
      <line x1="36" x2="36" y1="28" y2="164" />
      <polyline className="clean" points={cleanPoints} />
      <polyline className="lex" points={lexPoints} />
      {rows.map((row) => (
        <g key={row.alphaDeg}>
          <circle className="clean-dot" cx={xFor(row.alphaDeg)} cy={yFor(row.cleanCL)} r="3" />
          <circle className="lex-dot" cx={xFor(row.alphaDeg)} cy={yFor(row.lexCL)} r="3" />
          <text x={xFor(row.alphaDeg) - 10} y="180">{row.alphaDeg.toFixed(0)}</text>
        </g>
      ))}
      <text x="36" y="18">CL</text>
      <text x="310" y="18">Clean / LEX</text>
    </svg>
  );
}

function format(value: number | undefined, digits: number) {
  return typeof value === "number" ? value.toFixed(digits) : "--";
}

function formatSigned(value: number | undefined, digits: number) {
  if (typeof value !== "number") return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
