import { MessageSquareText, Ruler, Sparkles } from "lucide-react";

export type SizeAircraft = {
  payloadKg: number;
  enduranceMin: number;
  propulsion: "single prop" | "twin prop";
  powertrain: "electric" | "fuel";
  optimisation: string;
  wingSpanM: number;
  wingAreaM2: number;
  chordM: number;
  fuselageLengthM: number;
  fuselageDiameterM: number;
  tailSpanM: number;
  mtowKg: number;
  cruiseSpeedMS: number;
  batteryWh: number;
};

export function SizeWorkspace({
  aircraft,
  log,
  prompt,
  onPromptChange,
  onSubmit,
}: {
  aircraft: SizeAircraft;
  log: { role: string; text: string }[];
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <main className="size-workspace">
      <aside className="size-panel">
        <SizePanelTitle icon={<MessageSquareText size={18} />} title="Sizing Copilot" />
        <div className="chat-log size-chat-log">
          {log.map((entry, index) => (
            <div className={`chat-bubble ${entry.role}`} key={`${entry.role}-${index}`}>
              {entry.text}
            </div>
          ))}
        </div>
        <div className="prompt-box">
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          <div className="prompt-actions">
            <button onClick={onSubmit}>
              <Sparkles size={16} />
              Size
            </button>
          </div>
        </div>
      </aside>

      <section className="size-canvas-panel">
        <SizingCanvas aircraft={aircraft} />
      </section>

      <aside className="size-panel size-results">
        <SizePanelTitle icon={<Ruler size={18} />} title="Dimensions" />
        <div className="sizing-table">
          <div><span>Payload</span><strong>{aircraft.payloadKg.toFixed(1)} kg</strong></div>
          <div><span>MTOW</span><strong>{aircraft.mtowKg.toFixed(1)} kg</strong></div>
          <div><span>Wingspan</span><strong>{aircraft.wingSpanM.toFixed(2)} m</strong></div>
          <div><span>Wing area</span><strong>{aircraft.wingAreaM2.toFixed(2)} m2</strong></div>
          <div><span>Mean chord</span><strong>{aircraft.chordM.toFixed(2)} m</strong></div>
          <div><span>Fuselage</span><strong>{aircraft.fuselageLengthM.toFixed(2)} m</strong></div>
          <div><span>Cruise</span><strong>{(aircraft.cruiseSpeedMS * 3.6).toFixed(0)} km/h</strong></div>
          <div><span>Battery</span><strong>{aircraft.batteryWh.toFixed(0)} Wh</strong></div>
        </div>
      </aside>
    </main>
  );
}

function SizePanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="panel-title">
      {icon}
      {title}
    </h2>
  );
}

function SizingCanvas({ aircraft }: { aircraft: SizeAircraft }) {
  const scale = 95;
  const span = aircraft.wingSpanM * scale;
  const chord = aircraft.chordM * scale;
  const fuselage = aircraft.fuselageLengthM * scale;
  const diameter = aircraft.fuselageDiameterM * scale;
  const tail = aircraft.tailSpanM * scale;
  const centerX = 420;
  const topY = 145;
  const sideY = 385;
  const frontY = 610;
  const noseX = centerX - fuselage * 0.42;
  const tailX = centerX + fuselage * 0.58;
  const wingX = centerX - fuselage * 0.05;

  return (
    <svg className="sizing-canvas" viewBox="0 0 840 720" role="img" aria-label="Aircraft top side and front sizing views">
      <defs>
        <marker id="dimArrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#7dd3fc" />
        </marker>
      </defs>
      <SizingGrid />
      <text className="view-label" x="28" y="42">Top</text>
      <text className="view-label" x="28" y="282">Side</text>
      <text className="view-label" x="28" y="507">Front</text>

      <path className="aircraft-fill" d={`M${wingX - chord * 0.42},${topY - span / 2} L${wingX + chord * 0.58},${topY - span / 2 * 0.82} L${wingX + chord * 0.45},${topY + span / 2 * 0.82} L${wingX - chord * 0.42},${topY + span / 2} Z`} />
      <rect className="aircraft-body" x={noseX} y={topY - diameter / 2} width={fuselage} height={diameter} rx={diameter / 2} />
      <rect className="aircraft-line" x={tailX - tail * 0.25} y={topY - tail / 2} width={tail * 0.22} height={tail} />
      <circle className="prop-disc" cx={noseX + fuselage * 0.2} cy={topY - span / 2 - 10} r={diameter * 0.75} />
      <circle className="prop-disc" cx={noseX + fuselage * 0.2} cy={topY + span / 2 + 10} r={diameter * 0.75} />
      <Dimension x1={wingX} y1={topY - span / 2} x2={wingX} y2={topY + span / 2} label={`${aircraft.wingSpanM.toFixed(2)} m span`} offset={-34} vertical />
      <Dimension x1={wingX - chord * 0.42} y1={topY + span / 2 + 34} x2={wingX + chord * 0.58} y2={topY + span / 2 + 34} label={`${aircraft.chordM.toFixed(2)} m chord`} />

      <rect className="aircraft-body" x={noseX} y={sideY - diameter / 2} width={fuselage} height={diameter} rx={diameter / 2} />
      <path className="aircraft-fill" d={`M${wingX - chord * 0.45},${sideY} L${wingX + chord * 0.65},${sideY - diameter * 0.12} L${wingX + chord * 0.55},${sideY + diameter * 0.12} Z`} />
      <path className="aircraft-line" d={`M${tailX - tail * 0.2},${sideY} L${tailX},${sideY - diameter * 1.7} L${tailX + tail * 0.08},${sideY} Z`} />
      <Dimension x1={noseX} y1={sideY + 58} x2={tailX} y2={sideY + 58} label={`${aircraft.fuselageLengthM.toFixed(2)} m length`} />
      <Dimension x1={tailX + 34} y1={sideY - diameter / 2} x2={tailX + 34} y2={sideY + diameter / 2} label={`${aircraft.fuselageDiameterM.toFixed(2)} m dia`} offset={22} vertical />

      <path className="aircraft-fill" d={`M${centerX - span / 2},${frontY} L${centerX + span / 2},${frontY} L${centerX + span / 2 * 0.86},${frontY + 22} L${centerX - span / 2 * 0.86},${frontY + 22} Z`} />
      <ellipse className="aircraft-body" cx={centerX} cy={frontY + 8} rx={diameter * 0.75} ry={diameter * 1.15} />
      <circle className="prop-disc" cx={centerX - span * 0.33} cy={frontY} r={diameter * 0.95} />
      <circle className="prop-disc" cx={centerX + span * 0.33} cy={frontY} r={diameter * 0.95} />
      <Dimension x1={centerX - tail / 2} y1={frontY + 74} x2={centerX + tail / 2} y2={frontY + 74} label={`${aircraft.tailSpanM.toFixed(2)} m tail`} />
    </svg>
  );
}

function SizingGrid() {
  return (
    <g className="sizing-grid">
      {Array.from({ length: 18 }, (_, index) => <line key={`v-${index}`} x1={index * 50} y1="0" x2={index * 50} y2="720" />)}
      {Array.from({ length: 15 }, (_, index) => <line key={`h-${index}`} x1="0" y1={index * 50} x2="840" y2={index * 50} />)}
    </g>
  );
}

function Dimension({ x1, y1, x2, y2, label, offset = 0, vertical = false }: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  offset?: number;
  vertical?: boolean;
}) {
  const lx = vertical ? x1 + offset : (x1 + x2) / 2;
  const ly = vertical ? (y1 + y2) / 2 : y1 - 8;
  return (
    <g className="dimension">
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerStart="url(#dimArrow)" markerEnd="url(#dimArrow)" />
      <text x={lx} y={ly} transform={vertical ? `rotate(-90 ${lx} ${ly})` : undefined}>{label}</text>
    </g>
  );
}

export function sizeAircraftFromPrompt(text: string): SizeAircraft {
  const lower = text.toLowerCase();
  const payloadKg = parseMassKg(lower) ?? 2;
  const enduranceMin = parseDurationMin(lower) ?? 20;
  const twin = /\btwin|2\s*prop|dual\b/.test(lower);
  const electric = /\belectric|battery|lipo|li-ion\b/.test(lower);
  const cruise = /\bcruise|efficient|endurance\b/.test(lower);
  const mtowKg = payloadKg * (electric ? 2.45 : 2.1) + (twin ? 0.25 : 0);
  const cruiseSpeedMS = cruise ? 17 : 14;
  const wingAreaM2 = mtowKg / (cruise ? 8.5 : 7.2);
  const wingSpanM = Math.sqrt(wingAreaM2 * (cruise ? 8.8 : 7.2));
  const chordM = wingAreaM2 / wingSpanM;
  const fuselageLengthM = Math.max(wingSpanM * 0.72, 1.35);
  const fuselageDiameterM = Math.max(0.16, Math.cbrt(payloadKg) * 0.16);
  const tailSpanM = wingSpanM * 0.32;
  const batteryWh = electric ? (mtowKg * 95 * (enduranceMin / 60)) / 0.72 : 0;
  return {
    payloadKg,
    enduranceMin,
    propulsion: twin ? "twin prop" : "single prop",
    powertrain: electric ? "electric" : "fuel",
    optimisation: cruise ? "cruise optimised" : "general purpose",
    wingSpanM,
    wingAreaM2,
    chordM,
    fuselageLengthM,
    fuselageDiameterM,
    tailSpanM,
    mtowKg,
    cruiseSpeedMS,
    batteryWh,
  };
}

function parseMassKg(text: string) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(kg|g)\b/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2] === "g" ? value / 1000 : value;
}

function parseDurationMin(text: string) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(min|minute|minutes|hr|hour|hours)\b/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2].startsWith("h") ? value * 60 : value;
}
