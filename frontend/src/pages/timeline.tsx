import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { scaleUtc } from "d3-scale";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, ZoomBehavior, ZoomTransform } from "d3-zoom";
import { utcMonday } from "d3-time";
import { Milestone, Story, Timeline, loadCommits, loadMilestones, loadStories, loadTimeline } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

const W = 1000, ML = 124, MR = 12, LANE_H = 120, TOP = 18, STORY_H = 44, AXIS_H = 26;
const REPO_COLOR: Record<string, string> = { zaproxy: "#4389ff", "zap-extensions": "#e08e00", "zap-core-help": "#2f9e6f", "zap-hud": "#8e5bd0" };
const DETAIL_MONTHS = 30; // at or below this visible span, weekly bars come from the commit shards
type Metric = "commits" | "authors";
type Bar = { x0: Date; x1: Date; v: number };

const monthStart = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1));
const monthEnd = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1));
const storyDate = (d?: string) => d ? new Date(`${d.length === 4 ? d + "-01-01" : d.length === 7 ? d + "-01" : d}T00:00:00Z`) : null;
const slugOf = (id: string) => id.split(":").pop()!;

export default function TimelinePage() {
  const [tl, setTl] = useState<Timeline | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [error, setError] = useState("");
  const [metric, setMetric] = useState<Metric>("commits");
  const [t, setT] = useState<ZoomTransform>(zoomIdentity);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // repo -> year -> [[weekStartMs, author]] for the weekly detail view
  const [detail, setDetail] = useState<Record<string, Record<string, { w: number; a: string }[]>>>({});
  const overlay = useRef<SVGRectElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGRectElement, unknown> | null>(null);

  useEffect(() => {
    loadTimeline().then(setTl).catch(e => setError(e.message));
    loadMilestones().then(setMilestones).catch(() => {});
    loadStories().then(setStories).catch(() => {});
  }, []);

  const repos = useMemo(() => Object.keys(tl ?? {}), [tl]);
  const base = useMemo(() => {
    const months = Object.values(tl ?? {}).flatMap(m => Object.keys(m)).sort();
    if (!months.length) return null;
    return scaleUtc().domain([monthStart(months[0]), monthEnd(months[months.length - 1])]).range([ML, W - MR]);
  }, [tl]);
  const x = useMemo(() => (base ? t.rescaleX(base) : null), [base, t]);

  // d3-zoom on the overlay rect: drag to pan, ctrl or cmd + wheel (or double click) to zoom.
  useEffect(() => {
    if (!base || !overlay.current) return;
    const z = d3zoom<SVGRectElement, unknown>()
      .scaleExtent([1, 600])
      .extent([[ML, 0], [W - MR, 1]])
      .translateExtent([[ML, 0], [W - MR, 1]])
      .filter(e => (e.type !== "wheel" || e.ctrlKey || e.metaKey) && !e.button)
      .on("zoom", e => setT(e.transform));
    zoomRef.current = z;
    select(overlay.current).call(z);
  }, [base]);

  const call = useCallback((fn: (sel: any, z: ZoomBehavior<SVGRectElement, unknown>) => void) => {
    if (overlay.current && zoomRef.current) fn(select(overlay.current), zoomRef.current);
  }, []);
  const zoomBy = (f: number) => call((s, z) => z.scaleBy(s, f, [(ML + W - MR) / 2, 0]));
  const panBy = (px: number) => call((s, z) => z.translateBy(s, px / t.k, 0));
  const reset = () => call((s, z) => z.transform(s, zoomIdentity));
  const jumpToYear = (y: number) => {
    if (!base) return;
    const x0 = base(new Date(Date.UTC(y, 0, 1))), x1 = base(new Date(Date.UTC(y + 1, 0, 1)));
    const k = (W - MR - ML) / (x1 - x0);
    call((s, z) => z.transform(s, zoomIdentity.translate(ML - k * x0, 0).scale(k)));
  };

  const [d0, d1] = x ? x.domain() : [new Date(), new Date()];
  const spanMonths = (d1.getTime() - d0.getTime()) / (30.44 * 864e5);
  const weekly = spanMonths <= DETAIL_MONTHS;
  const visibleYears = useMemo(() => {
    const out: string[] = [];
    for (let y = d0.getUTCFullYear(); y <= d1.getUTCFullYear(); y++) out.push(String(y));
    return out;
  }, [d0.getUTCFullYear(), d1.getUTCFullYear()]);

  // Weekly detail: lazily load the per-year commit shards that are in view.
  useEffect(() => {
    if (!weekly || !tl) return;
    for (const repo of repos) for (const y of visibleYears) {
      if (detail[repo]?.[y] || !Object.keys(tl[repo]).some(m => m.startsWith(y))) continue;
      loadCommits(repo, y).then(cs => {
        const rows = cs.map(c => ({ w: utcMonday.floor(new Date(c.committer_date)).getTime(), a: c.author_name }));
        setDetail(d => ({ ...d, [repo]: { ...d[repo], [y]: rows } }));
      }).catch(() => setDetail(d => ({ ...d, [repo]: { ...d[repo], [y]: [] } })));
    }
  }, [weekly, tl, repos, visibleYears, detail]);

  const bars = (repo: string): { bars: Bar[]; mode: "weekly" | "monthly" } => {
    const ready = weekly && visibleYears.every(y => detail[repo]?.[y] || !Object.keys(tl![repo]).some(m => m.startsWith(y)));
    if (ready) {
      const byWeek = new Map<number, { n: number; a: Set<string> }>();
      for (const y of visibleYears) for (const r of detail[repo]?.[y] ?? []) {
        const e = byWeek.get(r.w) ?? { n: 0, a: new Set<string>() };
        e.n++; e.a.add(r.a); byWeek.set(r.w, e);
      }
      return { mode: "weekly", bars: [...byWeek].map(([w, e]) => ({ x0: new Date(w), x1: new Date(w + 7 * 864e5), v: metric === "commits" ? e.n : e.a.size })) };
    }
    return { mode: "monthly", bars: Object.entries(tl![repo]).map(([m, [n, a]]) => ({ x0: monthStart(m), x1: monthEnd(m), v: metric === "commits" ? n : a })) };
  };

  if (error) return <ErrorBox message={error} />;
  if (!tl || !x || !base) return <Loading />;

  const laneData = repos.map(r => bars(r));
  const plotBottom = TOP + STORY_H + repos.length * LANE_H;
  const H = plotBottom + AXIS_H;
  const inView = (a: Date, b: Date = a) => x(b) >= ML && x(a) <= W - MR;
  const releases = milestones.filter(m => m.kind !== "addon-release" && inView(new Date(m.date)));
  const dated = stories.map(s => ({ s, d: storyDate(s.date) })).filter((r): r is { s: Story; d: Date } => !!r.d);
  const perDay = new Map<string, number>();
  const levelOf = (s: Story) => { const k = s.date ?? ""; const n = perDay.get(k) ?? 0; perDay.set(k, n + 1); return n % 3; };
  const ticks = x.ticks(8);
  const fmt = x.tickFormat(8);
  const years = base.ticks(20).map(d => d.getUTCFullYear());
  const yearly = repos.map(r => {
    const out: Record<string, number> = {};
    for (const [m, [n]] of Object.entries(tl[r])) out[m.slice(0, 4)] = (out[m.slice(0, 4)] ?? 0) + n;
    return out;
  });
  const allYears = [...new Set(yearly.flatMap(o => Object.keys(o)))].sort();

  // Bars sit under the zoom overlay so dragging works everywhere; hover is resolved from the pointer position.
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement, box = wrap.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !box || !ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const lane = Math.floor((pt.y - TOP - STORY_H) / LANE_H);
    if (lane < 0 || lane >= repos.length) return setTip(null);
    const at = x.invert(pt.x).getTime();
    const { bars: lb, mode } = laneData[lane];
    const hit = lb.find(b => b.x0.getTime() <= at && at < b.x1.getTime());
    if (!hit) return setTip(null);
    const rect = box.getBoundingClientRect();
    const day = hit.x0.toISOString().slice(0, 10);
    const when = mode === "weekly" ? `week of ${day}` : day.slice(0, 7);
    const what = metric === "commits" ? `${hit.v.toLocaleString()} ${hit.v === 1 ? "commit" : "commits"}` : `${hit.v.toLocaleString()} active ${hit.v === 1 ? "author" : "authors"}`;
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: `${repos[lane]} · ${when} · ${what}` });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") panBy(120); else if (e.key === "ArrowRight") panBy(-120);
    else if (e.key === "+" || e.key === "=") zoomBy(1.5); else if (e.key === "-") zoomBy(1 / 1.5);
    else if (e.key === "0") reset(); else return;
    e.preventDefault();
  };
  const btn = "px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 text-sm hover:border-indigo-400";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Timeline</h1>
      <p className="text-slate-600">
        Activity in each repository, stacked on one time axis. Orange diamonds are stories, vertical lines are
        core release tags. Zoom in to see weekly bars; zoom out for monthly totals.
      </p>
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <label>Show{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={metric} onChange={e => setMetric(e.target.value as Metric)}>
            <option value="commits">Commits</option>
            <option value="authors">Active authors</option>
          </select>
        </label>
        <label>Jump to{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value="" onChange={e => e.target.value && jumpToYear(+e.target.value)}>
            <option value="">year</option>
            {years.map(y => <option key={y}>{y}</option>)}
          </select>
        </label>
        <button className={btn} onClick={() => panBy(120)} aria-label="Pan earlier">←</button>
        <button className={btn} onClick={() => panBy(-120)} aria-label="Pan later">→</button>
        <button className={btn} onClick={() => zoomBy(1.5)} aria-label="Zoom in">+</button>
        <button className={btn} onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">−</button>
        <button className={btn} onClick={reset}>Reset</button>
        <span className="text-slate-500">
          {d0.toISOString().slice(0, 10)} to {d1.toISOString().slice(0, 10)} · {weekly ? "weekly" : "monthly"} bars
        </span>
      </div>
      <div ref={wrap} className="relative rounded-xl border border-slate-200 bg-white p-2" tabIndex={0} role="group" onKeyDown={onKey}
        aria-label="Timeline chart. Arrow keys pan, plus and minus zoom, zero resets.">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label="Commits per repository over time with release and story markers; a table follows">
          <defs><clipPath id="plot"><rect x={ML} y={0} width={W - ML - MR} height={H} /></clipPath></defs>
          <g className="text-slate-500" fill="currentColor" fontSize="11">
            {ticks.map(d => (
              <g key={d.getTime()}>
                <line x1={x(d)} x2={x(d)} y1={TOP} y2={plotBottom} stroke="currentColor" strokeOpacity={0.15} />
                <text x={x(d)} y={H - 8} textAnchor="middle">{fmt(d)}</text>
              </g>
            ))}
          </g>
          <rect ref={overlay} x={ML} y={0} width={W - ML - MR} height={plotBottom} fill="transparent" style={{ cursor: "grab", touchAction: "none" }} onMouseMove={onMove} onMouseLeave={() => setTip(null)} />
          <g clipPath="url(#plot)">
            {repos.map((repo, i) => {
              const top = TOP + STORY_H + i * LANE_H, h = LANE_H - 26;
              const { bars: all, mode } = laneData[i];
              const vis = all.filter(b => inView(b.x0, b.x1));
              const max = Math.max(1, ...vis.map(b => b.v));
              return (
                <g key={repo} pointerEvents="none">
                  <line x1={ML} x2={W - MR} y1={top + h + 4} y2={top + h + 4} stroke="currentColor" strokeOpacity={0.3} className="text-slate-400" />
                  {vis.map(b => {
                    const bh = Math.max(1, (b.v / max) * h);
                    return <rect key={b.x0.getTime()} x={x(b.x0)} y={top + 4 + h - bh} width={Math.max(1, x(b.x1) - x(b.x0) - 1)} height={bh} fill={REPO_COLOR[repo] ?? "#7e92a4"} />;
                  })}
                  <text x={W - MR - 4} y={top + 14} textAnchor="end" fontSize="10" fill="currentColor" className="text-slate-500">max {max} per {mode === "weekly" ? "week" : "month"}</text>
                </g>
              );
            })}
          </g>
          {repos.map((repo, i) => (
            <text key={repo} x={8} y={TOP + STORY_H + i * LANE_H + 22} fontSize="12" fontWeight="bold" fill="currentColor" className="text-slate-700">{repo}</text>
          ))}
          <text x={8} y={TOP + 14} fontSize="12" fontWeight="bold" fill="currentColor" className="text-slate-700">Stories</text>
          <g clipPath="url(#plot)">
            {repos.map((repo, i) => releases.filter(m => m.repository === repo).map(m => {
              const top = TOP + STORY_H + i * LANE_H, mx = x(new Date(m.date));
              return (
                <Link key={m.id} to={`/release/${encodeURIComponent(m.id)}`}>
                  <title>{`${m.title} · ${m.date.slice(0, 10)}`}</title>
                  <line x1={mx} x2={mx} y1={top + 2} y2={top + LANE_H - 22} stroke="#00549e" strokeWidth={1.2} strokeOpacity={0.7} />
                  <line x1={mx} x2={mx} y1={top + 2} y2={top + LANE_H - 22} stroke="transparent" strokeWidth={8} />
                </Link>
              );
            }))}
            {dated.filter(r => inView(r.d)).map(({ s, d }) => {
              const cx = x(d), cy = TOP + 8 + levelOf(s) * 12;
              return (
                <Link key={s.id} to={`/stories/${slugOf(s.id)}`}>
                  <title>{`${s.title} · ${s.date}`}</title>
                  <path d={`M${cx} ${cy - 5}L${cx + 5} ${cy}L${cx} ${cy + 5}L${cx - 5} ${cy}Z`} fill="#e08e00" stroke="#7a4f00" strokeWidth={0.8} />
                </Link>
              );
            })}
          </g>
        </svg>
        {tip && (
          <div role="tooltip" className="pointer-events-none absolute z-10 rounded bg-slate-800 text-white text-xs px-2 py-1 shadow whitespace-nowrap"
            style={{ left: Math.min(tip.x + 12, (wrap.current?.clientWidth ?? 0) - 260), top: tip.y + 12 }}>{tip.text}</div>
        )}
      </div>
      <p className="text-xs text-slate-400">
        Drag to pan. Ctrl or cmd + scroll, double click, or the buttons zoom. Dates are committer dates. Line counts are not shown
        because the dataset does not record them yet. Add-on release tags are on the <Link className="text-indigo-600 hover:underline" to="/releases">Releases</Link> page.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-indigo-600">Table: commits per year</summary>
        <div className="overflow-x-auto mt-2">
          <table className="text-sm border-collapse" aria-label="Commits per year by repository">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="pr-4 pb-1">Year</th>{repos.map(r => <th key={r} className="pr-4 pb-1">{r}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {allYears.map(y => (
                <tr key={y}><td className="pr-4">{y}</td>{yearly.map((o, i) => <td key={repos[i]} className="pr-4">{o[y] ?? 0}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
