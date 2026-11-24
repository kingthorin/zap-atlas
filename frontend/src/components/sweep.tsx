import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AuthorMonths, loadAuthorModules } from "../lib/data";

const TOP_AUTHORS = 8;          // authors shown per month, by commits
const STEP_MS = 1800;           // one month at 1x
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isDark = () => document.documentElement.classList.contains("dark");
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 3;
/** Accounts that commit automatically: zapbot (all its display names), dependabot and GitHub Actions. */
const isBot = (name: string) => /^zapbot\b|\[bot\]$|^github-actions/i.test(name);
const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

interface Actor { name: string; total: number; mods: { id: string; n: number; x: number; y: number }[] }
export interface SweepProps {
  host: HTMLElement | null;                                       // the element that holds the graph canvas; the overlay goes into it
  nodePosition: (id: string) => { x: number; y: number } | null;  // viewport position of a module, null when it is not drawn
  colorOf: (id: string) => string;
  label: (id: string) => string;
  minYear: number; maxYear: number;
}

/** Plays through the months: the people who committed in a month swoop in, send a pulse to each module they touched, and leave. */
export default function Sweep({ host, nodePosition, colorOf, label, minYear, maxYear }: SweepProps) {
  const now = new Date();
  const last = Math.min((maxYear - minYear) * 12 + 11, (now.getUTCFullYear() - minYear) * 12 + now.getUTCMonth());
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [bots, setBots] = useState(false);
  const [data, setData] = useState<AuthorMonths>({});
  const canvas = useRef<HTMLCanvasElement>(null);
  const month = `${minYear + Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, "0")}`;
  const year = +month.slice(0, 4);

  useEffect(() => { let live = true; loadAuthorModules(year).then(d => live && setData(d)); return () => { live = false; }; }, [year]);

  const rows = data[month] ?? [];
  /** The month's most active people, each with the modules that are drawn. */
  const actors = useMemo(() => {
    const by = new Map<string, Actor>();
    for (const [name, id, n] of rows) {
      if (!bots && isBot(name)) continue;
      const a = by.get(name) ?? by.set(name, { name, total: 0, mods: [] }).get(name)!;
      a.total += n; a.mods.push({ id, n, x: 0, y: 0 });
    }
    return [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, TOP_AUTHORS);
  }, [rows, bots]);
  const touched = useMemo(() => actors.map(a => ({ ...a, mods: a.mods.filter(m => nodePosition(m.id)) })).filter(a => a.mods.length), [actors, nodePosition]);

  useEffect(() => {
    const cv = canvas.current, ctx = cv?.getContext("2d");
    const step = STEP_MS / speed;
    let raf = 0, timer = 0, done = false;
    const advance = () => { if (done) return; if (playing) idx < last ? setIdx(i => i + 1) : setPlaying(false); };
    if (!cv || !ctx || reduceMotion() || !host) { if (playing) timer = window.setTimeout(advance, step * 0.6); return () => window.clearTimeout(timer); }
    const dpr = window.devicePixelRatio || 1, w = host.clientWidth, h = host.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    const start = performance.now(), dark = isDark();
    const draw = (t: number) => {
      const p = clamp((t - start) / step);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      touched.forEach((a, i) => {
        const pts = a.mods.map(m => ({ ...m, ...nodePosition(m.id)! }));
        const cx = pts.reduce((s, m) => s + m.x, 0) / pts.length, cy = pts.reduce((s, m) => s + m.y, 0) / pts.length;
        const ang = (hash(a.name) % 3600) / 3600 * Math.PI * 2, R = Math.max(w, h) * 0.55;
        const sx = w / 2 + Math.cos(ang) * R, sy = h / 2 + Math.sin(ang) * R;
        const dx = sx - cx, dy = sy - cy, d = Math.hypot(dx, dy) || 1;
        const hx = cx + dx / d * 70, hy = cy + dy / d * 70;                      // where the person hovers
        const q = clamp((p - i * 0.04) / 0.8);
        let x = hx, y = hy, alpha = 1;
        if (q < 0.25) { const e = easeOut(q / 0.25); x = lerp(sx, hx, e); y = lerp(sy, hy, e); alpha = e; }
        else if (q > 0.75) { const e = easeIn((q - 0.75) / 0.25); x = lerp(hx, sx, e); y = lerp(hy, sy, e); alpha = 1 - e; }
        else {
          const f = (q - 0.25) / 0.5;                                              // pulses to each module
          pts.forEach((m, j) => {
            for (let k = 0; k < Math.min(m.n, 3); k++) {
              const u = (f - (k * 0.2 + j * 0.06)) / 0.3;
              if (u <= 0 || u >= 1.4) continue;
              ctx.strokeStyle = ctx.fillStyle = colorOf(m.id);
              if (u < 1) {
                const head = easeOut(u), tail = Math.max(0, head - 0.25);
                ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.beginPath();
                ctx.moveTo(lerp(hx, m.x, tail), lerp(hy, m.y, tail)); ctx.lineTo(lerp(hx, m.x, head), lerp(hy, m.y, head)); ctx.stroke();
              } else {
                const g = (u - 1) / 0.4;
                ctx.globalAlpha = 0.8 * (1 - g); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(m.x, m.y, 6 + 14 * g, 0, Math.PI * 2); ctx.stroke();
              }
            }
          });
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#e11d74"; ctx.strokeStyle = dark ? "#0f172a" : "#ffffff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = "11px system-ui, sans-serif"; ctx.textBaseline = "middle";
        const tw = ctx.measureText(a.name).width, lx = clamp(x + 9, 2, w - tw - 8);
        ctx.fillStyle = dark ? "rgba(15,23,42,0.8)" : "rgba(255,255,255,0.85)"; ctx.fillRect(lx - 3, y - 8, tw + 6, 16);
        ctx.fillStyle = dark ? "#e2e8f0" : "#334155"; ctx.fillText(a.name, lx, y);
      });
      ctx.globalAlpha = 1;
      if (p < 1) raf = requestAnimationFrame(draw);
      else { ctx.clearRect(0, 0, w, h); advance(); }
    };
    raf = requestAnimationFrame(draw);
    return () => { done = true; cancelAnimationFrame(raf); window.clearTimeout(timer); ctx.clearRect(0, 0, w, h); };
  }, [touched, playing, speed, host, idx, last, nodePosition, colorOf]);

  const summary = actors.length
    ? actors.map(a => `${a.name}: ${[...a.mods].sort((x, y) => y.n - x.n).slice(0, 3).map(m => `${label(m.id)} (${m.n})`).join(", ")}${a.mods.length > 3 ? ` and ${a.mods.length - 3} more` : ""}`).join("; ")
    : "no commits recorded for the modules in this month";
  const btn = "px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 text-sm hover:border-indigo-400";
  return (
    <div className="px-3 py-2 border-t border-slate-100 text-xs text-slate-600 space-y-1">
      {host && createPortal(<canvas ref={canvas} aria-hidden="true" className="absolute inset-0 pointer-events-none" />, host)}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Sweep through time</span>
        <button className={btn} onClick={() => { if (!playing && idx >= last) setIdx(0); setPlaying(p => !p); }}>{playing ? "Pause" : "Play"}</button>
        <input type="range" min={0} max={last} value={idx} className="flex-1 min-w-[10rem]" aria-label="Month" aria-valuetext={month}
          onChange={e => { setPlaying(false); setIdx(+e.target.value); }} />
        <span className="w-16 tabular-nums">{month}</span>
        <label>Speed{" "}
          <select className="border border-slate-300 rounded px-1 py-0.5 bg-white" value={speed} onChange={e => setSpeed(+e.target.value)}>
            {[0.5, 1, 2, 4].map(s => <option key={s} value={s}>{s}x</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={bots} onChange={e => setBots(e.target.checked)} />Include bots</label>
      </div>
      <p aria-live={playing ? "off" : "polite"}>
        {month}: {summary}. Authors are the names on commits, the top {TOP_AUTHORS} by commits each month{bots ? "" : " (bots left out: zapbot, dependabot, GitHub Actions)"}, credited to a file's current module.
      </p>
    </div>
  );
}
