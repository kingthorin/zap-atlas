import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AuthorMonths, loadAuthorModules } from "../lib/data";

const TOP_AUTHORS = 8;          // people shown per month, by commits; everyone else is pooled as "Other"
const MAX_PINNED = 4;           // extra people shown because the viewer asked for them
const STEP_MS = 1800;           // one month at 1x
const SIDE_MIN_ROW = 820;       // the names go in a column beside the graph when the graph card is at least this wide
const PALETTE = ["#e11d74", "#14b8a6", "#6366f1", "#84cc16", "#d946ef", "#06b6d4", "#f97316", "#eab308", "#8b5cf6", "#22c55e", "#ec4899", "#0ea5e9"];
const OTHER_COLOR = "#64748b";
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isDark = () => document.documentElement.classList.contains("dark");
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 3;
/** Accounts that commit automatically: zapbot (all its display names), dependabot and GitHub Actions. */
const isBot = (name: string) => /^zapbot\b|\[bot\]$|^github-actions/i.test(name);

interface Actor { name: string; total: number; mods: { id: string; n: number }[]; color: string; people?: number; pinned?: boolean }
export interface SweepProps {
  host: HTMLElement | null;                                       // the element that holds the graph canvas; the overlay goes into it
  side: HTMLElement | null;                                       // beside the graph: the names go here when there is room
  fit: () => void;                                                // resize the graph to its container and zoom out enough to leave a margin round it for the contributors
  onView: (cb: () => void) => () => void;                         // calls back whenever the graph is panned, zoomed or resized; returns an unsubscribe
  bounds: () => { cx: number; cy: number; rx: number; ry: number } | null;   // the drawn nodes' extent in viewport pixels: centre and half-width, half-height
  nodePosition: (id: string) => { x: number; y: number } | null;  // viewport position of a module, null when it is not drawn
  colorOf: (id: string) => string;
  label: (id: string) => string;
  minYear: number; maxYear: number;
}

/** Plays through the months: the people who committed in a month swoop in, send pulses to the modules they touched, and leave. */
export default function Sweep({ host, side, fit, onView, bounds, nodePosition, label, minYear, maxYear }: SweepProps) {
  const now = new Date();
  const last = Math.min((maxYear - minYear) * 12 + 11, (now.getUTCFullYear() - minYear) * 12 + now.getUTCMonth());
  const [first, setFirst] = useState(0);                       // the first month that has any contribution
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [engaged, setEngaged] = useState(false);               // the viewer has used the sweep: only then does the names column take space
  const [speed, setSpeed] = useState(1);
  const [bots, setBots] = useState(false);
  const [pin, setPin] = useState("");
  const [data, setData] = useState<AuthorMonths>({});
  const [rowW, setRowW] = useState(0);
  const [view, setView] = useState(0);                      // bumped when the graph moves, so a paused frame is drawn again
  const canvas = useRef<HTMLCanvasElement>(null);
  const progress = useRef(0);                              // how far through the month's animation we are, kept across pause and play
  const shownMonth = useRef("");
  const held = useRef(false);                              // the paused frame is the generic still frame, not a moment of a run
  const month = `${minYear + Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, "0")}`;
  const year = +month.slice(0, 4);

  useEffect(() => { let live = true; loadAuthorModules(year).then(d => live && setData(d)); return () => { live = false; }; }, [year]);

  // Start at the first month with a contribution, not at January of the first year.
  useEffect(() => {
    let live = true;
    (async () => {
      for (let y = minYear; y <= maxYear; y++) {
        const m = Object.keys(await loadAuthorModules(y)).sort()[0];
        if (!m) continue;
        const i = (+m.slice(0, 4) - minYear) * 12 + (+m.slice(5, 7) - 1);
        if (live) { setFirst(i); setIdx(c => Math.max(c, i)); }
        return;
      }
    })();
    return () => { live = false; };
  }, [minYear, maxYear]);

  // The names go beside the graph when the card is wide enough, otherwise they are drawn on it.
  const row = host?.parentElement ?? null;
  useEffect(() => {
    if (!row) return;
    const ro = new ResizeObserver(() => setRowW(row.clientWidth));
    ro.observe(row); setRowW(row.clientWidth);
    return () => ro.disconnect();
  }, [row]);
  const outside = engaged && !!side && rowW >= SIDE_MIN_ROW;
  useEffect(() => { if (!engaged) return; const id = requestAnimationFrame(() => { fit(); setView(v => v + 1); }); return () => cancelAnimationFrame(id); }, [outside, engaged, fit]);
  useEffect(() => {
    let raf = 0;
    const off = onView(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setView(v => v + 1)); });
    return () => { off(); cancelAnimationFrame(raf); };
  }, [onView]);

  /** The month's people: the most active ones, anyone the viewer asked for, and everyone else pooled as "Other". */
  const actors = useMemo(() => {
    const by = new Map<string, Actor>();
    for (const [name, id, n] of data[month] ?? []) {
      if (!bots && isBot(name)) continue;
      const a = by.get(name) ?? by.set(name, { name, total: 0, mods: [], color: "" }).get(name)!;
      a.total += n; a.mods.push({ id, n });
    }
    const sorted = [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const q = pin.trim().toLowerCase();
    const top = sorted.slice(0, TOP_AUTHORS);
    const pinned = q ? sorted.slice(TOP_AUTHORS).filter(a => a.name.toLowerCase().includes(q)).slice(0, MAX_PINNED) : [];
    const rest = sorted.slice(TOP_AUTHORS).filter(a => !pinned.includes(a));
    const out: Actor[] = [...top, ...pinned.map(a => ({ ...a, pinned: true }))];
    if (q) top.forEach(a => { if (a.name.toLowerCase().includes(q)) a.pinned = true; });
    out.forEach((a, i) => { a.color = PALETTE[i % PALETTE.length]; });
    if (rest.length) {
      const mods = new Map<string, number>();
      for (const a of rest) for (const m of a.mods) mods.set(m.id, (mods.get(m.id) ?? 0) + m.n);
      out.push({ name: `Other (${rest.length})`, total: rest.reduce((s, a) => s + a.total, 0), color: OTHER_COLOR, people: rest.length,
        mods: [...mods].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n).slice(0, 12) });
    }
    return out;
  }, [data, month, bots, pin]);
  const touched = useMemo(() => actors.map(a => ({ ...a, mods: a.mods.filter(m => nodePosition(m.id)) })).filter(a => a.mods.length), [actors, nodePosition]);

  useEffect(() => {
    const cv = canvas.current, ctx = cv?.getContext("2d");
    const step = STEP_MS / speed;
    let raf = 0, timer = 0, done = false;
    const advance = () => {
      if (done || !playing) return;
      if (idx < last) setIdx(i => i + 1); else { progress.current = 0.5; setPlaying(false); }
    };
    // Same month: carry on from where it stopped. A new month starts at the beginning when playing, or as a still frame (everyone hovering) when paused.
    const resume = shownMonth.current === month ? (playing && held.current ? 0 : progress.current) : playing ? 0 : 0.5;
    held.current = playing ? false : shownMonth.current !== month || held.current;
    shownMonth.current = month;
    if (!cv || !ctx || reduceMotion() || !host) { if (playing) timer = window.setTimeout(advance, step * 0.6); return () => window.clearTimeout(timer); }
    const dpr = window.devicePixelRatio || 1, w = host.clientWidth, h = host.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    const dark = isDark();
    const ink = dark ? "#e2e8f0" : "#1e293b", paper = dark ? "#0f172a" : "#ffffff";

    const pill = (text: string, x: number, y: number, color: string, bold = false, align: "left" | "center" | "right" = "left") => {
      ctx.font = `${bold ? "600 " : ""}12px system-ui, sans-serif`; ctx.textBaseline = "middle";
      const tw = ctx.measureText(text).width, lx = clamp(align === "center" ? x - tw / 2 : align === "right" ? x - tw : x, 5, w - tw - 9);
      ctx.fillStyle = paper; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(lx - 4, y - 9, tw + 8, 18, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = ink; ctx.fillText(text, lx, y);
    };

    const frame = (p: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const reached: { id: string; x: number; y: number; color: string; a: number }[] = [];
      // The contributors wait on a ring outside the graph, each at the angle of the modules it touched, and fire inwards.
      const b = bounds() ?? { cx: w / 2, cy: h / 2, rx: w * 0.3, ry: h * 0.3 };
      const rx = clamp(b.rx + 40, 40, w / 2 - 14), ry = clamp(b.ry + 40, 40, h / 2 - 14);
      const where = touched.map(a => a.mods.map(m => ({ ...m, ...nodePosition(m.id)! })));
      const order = where.map((ps, i) => ({ i, th: Math.atan2((ps.reduce((s, m) => s + m.y, 0) / ps.length - b.cy) / b.ry, (ps.reduce((s, m) => s + m.x, 0) / ps.length - b.cx) / b.rx) }))
        .sort((u, v) => u.th - v.th);
      const gap = 0.32;                                              // keep neighbours on the ring apart, so the dots and names do not pile up
      for (let k = 1; k < order.length; k++) if (order[k].th - order[k - 1].th < gap) order[k].th = order[k - 1].th + gap;
      const over = order.length ? order[order.length - 1].th - (order[0].th + Math.PI * 2 - gap) : 0;
      if (over > 0) order.forEach(o => { o.th -= over / 2; });
      const angleOf = new Map(order.map(o => [o.i, o.th]));
      touched.forEach((a, i) => {
        const pts = where[i], th = angleOf.get(i)!, ux = Math.cos(th), uy = Math.sin(th), far = Math.hypot(w, h) / 2 + 40;
        const hx = clamp(b.cx + ux * rx, 12, w - 12), hy = clamp(b.cy + uy * ry, 12, h - 12);       // where the person hovers
        const sx = b.cx + ux * far, sy = b.cy + uy * far;
        const q = clamp((p - i * 0.03) / 0.7);
        let x = hx, y = hy, alpha = 1;
        if (q < 0.25) { const e = easeOut(q / 0.25); x = lerp(sx, hx, e); y = lerp(sy, hy, e); alpha = e; }
        else if (q > 0.75) { const e = easeIn((q - 0.75) / 0.25); x = lerp(hx, sx, e); y = lerp(hy, sy, e); alpha = 1 - e; }
        else {
          const f = (q - 0.25) / 0.5;                                                  // pulses to each module
          ctx.strokeStyle = a.color; ctx.lineWidth = 1; ctx.globalAlpha = 0.25; ctx.setLineDash([3, 4]);
          pts.forEach(m => { ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(m.x, m.y); ctx.stroke(); });
          ctx.setLineDash([]);
          pts.forEach((m, j) => {
            const shots = a.people ? 1 : Math.min(m.n, 3), width = 2.5 + Math.min(3, Math.log2(1 + m.n));
            for (let k = 0; k < shots; k++) {
              const u = (f - (k * 0.2 + j * 0.05)) / 0.3;
              ctx.strokeStyle = ctx.fillStyle = a.color;
              if (u > 0 && u < 1) {
                const head = easeOut(u), tail = Math.max(0, head - 0.3), hxp = lerp(hx, m.x, head), hyp = lerp(hy, m.y, head);
                ctx.globalAlpha = 0.95; ctx.lineWidth = width; ctx.lineCap = "round";
                ctx.beginPath(); ctx.moveTo(lerp(hx, m.x, tail), lerp(hy, m.y, tail)); ctx.lineTo(hxp, hyp); ctx.stroke();
                ctx.beginPath(); ctx.arc(hxp, hyp, width + 1.5, 0, Math.PI * 2); ctx.fill();
              } else if (u >= 1 && u < 1.5) {
                const g = (u - 1) / 0.5;
                ctx.globalAlpha = 0.9 * (1 - g); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(m.x, m.y, 8 + 16 * g, 0, Math.PI * 2); ctx.stroke();
              }
              if (u >= 0.85 && u < 2.2) reached.push({ id: m.id, x: m.x, y: m.y, color: a.color, a: u < 1.9 ? 1 : (2.2 - u) / 0.3 });
            }
          });
        }
        const r = 6 + Math.min(7, Math.log2(1 + a.total) * 1.3);                         // the dot grows with the person's commits
        ctx.globalAlpha = alpha;
        ctx.fillStyle = a.color; ctx.strokeStyle = paper; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (a.pinned) { ctx.strokeStyle = a.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke(); }
        if (ux >= 0) pill(a.name, x + r + 5, y, a.color, !!a.pinned); else pill(a.name, x - r - 5, y, a.color, !!a.pinned, "right");   // the name rides on the outer side of the dot
      });
      // A module that is being hit shows its name for a moment.
      const seen = new Set<string>();
      for (const m of reached.sort((a, b) => b.a - a.a)) {
        if (seen.has(m.id)) continue;
        seen.add(m.id); ctx.globalAlpha = clamp(m.a);
        pill(label(m.id), m.x, m.y - 20, m.color, true, "center");
      }
      ctx.globalAlpha = 1;
    };

    if (!playing) { progress.current = resume; frame(resume); return () => { done = true; ctx.clearRect(0, 0, w, h); }; }   // paused: a still frame, names kept
    const start = performance.now() - resume * step;
    const run = (t: number) => {
      const p = clamp((t - start) / step);
      progress.current = p;
      frame(p);
      if (p < 1) raf = requestAnimationFrame(run);
      else { ctx.clearRect(0, 0, w, h); advance(); }
    };
    raf = requestAnimationFrame(run);
    return () => { done = true; cancelAnimationFrame(raf); window.clearTimeout(timer); };
  }, [touched, playing, speed, host, idx, last, nodePosition, bounds, label, outside, month, playing ? 0 : view]);

  const people = actors.filter(a => !a.people), other = actors.find(a => a.people);
  const summary = actors.length
    ? `${people.map(a => `${a.name}: ${[...a.mods].sort((x, y) => y.n - x.n).slice(0, 3).map(m => `${label(m.id)} (${m.n})`).join(", ")}${a.mods.length > 3 ? ` and ${a.mods.length - 3} more` : ""}`).join("; ")}${other ? `; ${other.people} other${other.people === 1 ? "" : "s"} (${other.total} commit${other.total === 1 ? "" : "s"})` : ""}`
    : "no commits recorded for the modules in this month";
  const names = (
    <aside aria-label={`Contributors in ${month}`} className="w-52 shrink-0 border-l border-slate-100 p-2 text-xs overflow-y-auto" style={{ maxHeight: host?.clientHeight }}>
      <div className="font-semibold text-slate-700 mb-1">{month}</div>
      <ul className="space-y-1.5">
        {actors.map(a => (
          <li key={a.name} className="flex gap-1.5 items-start">
            <span className="mt-0.5 inline-block w-3 h-3 rounded-full shrink-0 border border-white" style={{ background: a.color }} aria-hidden="true" />
            <span><span className={a.pinned ? "font-bold" : "font-medium"}>{a.name}</span> <span className="text-slate-500">{a.total}</span>
              <span className="block text-slate-500">{[...a.mods].sort((x, y) => y.n - x.n).slice(0, 2).map(m => label(m.id)).join(", ")}{a.mods.length > 2 ? ` +${a.mods.length - 2}` : ""}</span></span>
          </li>
        ))}
        {actors.length === 0 && <li className="text-slate-500">No commits for the modules shown.</li>}
      </ul>
    </aside>
  );
  return (
    <div className="px-3 py-2 border-t border-slate-100 text-xs text-slate-600 space-y-1">
      {host && createPortal(<canvas ref={canvas} aria-hidden="true" className="absolute inset-0 pointer-events-none" />, host)}
      {outside && side && createPortal(names, side)}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Sweep through time</span>
        <button className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-indigo-600 text-white text-sm font-semibold border border-indigo-700 hover:bg-indigo-700"
          aria-pressed={playing} onClick={() => { setEngaged(true); if (!playing && idx >= last) setIdx(first); setPlaying(p => !p); }}>
          {playing
            ? <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 001.5.86l12-7.5a1 1 0 000-1.72l-12-7.5A1 1 0 007 4.5z" /></svg>}
          {playing ? "Pause" : "Play"}
        </button>
        <input type="range" min={first} max={last} value={idx} className="flex-1 min-w-[10rem]" aria-label="Month" aria-valuetext={month}
          onChange={e => { setEngaged(true); setPlaying(false); setIdx(+e.target.value); }} />
        <span className="w-16 tabular-nums">{month}</span>
        <label>Speed{" "}
          <select className="border border-slate-300 rounded px-1 py-0.5 bg-white" value={speed} onChange={e => setSpeed(+e.target.value)}>
            {[0.5, 1, 1.5, 2, 4].map(s => <option key={s} value={s}>{s}x</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={bots} onChange={e => setBots(e.target.checked)} />Include bots</label>
        <label>Always show{" "}
          <input value={pin} onChange={e => { setEngaged(true); setPin(e.target.value); }} placeholder="a name or username" className="border border-slate-300 rounded px-1.5 py-0.5 bg-white w-36" />
        </label>
      </div>
      <p aria-live={playing ? "off" : "polite"}>
        {month}: {summary}. These are the names on commits: the top {TOP_AUTHORS} by commits each month{pin.trim() ? ", plus anyone matching the text above" : ""}, with everyone else pooled as Other{bots ? "" : " (bots left out: zapbot, dependabot, GitHub Actions)"}, credited to a file's current module.
      </p>
    </div>
  );
}
