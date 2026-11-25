import { useEffect, useMemo, useState } from "react";
import { scaleUtc } from "d3-scale";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CoreWindows, Milestone, Repo, githubTag, loadCoreWindows, loadMilestones, loadRepos, shaOf } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

const KINDS: { id: string; label: string }[] = [
  { id: "core-release", label: "ZAP releases" },
  { id: "addon-release", label: "Add-on releases" },
  { id: "hud-release", label: "HUD releases" },
  { id: "extensions-release", label: "Early zap-extensions releases" },
];
const day = (iso: string) => iso.slice(0, 10);

function useReleases() {
  const [data, setData] = useState<{ ms: Milestone[]; repos: Repo[]; windows: CoreWindows } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([loadMilestones(), loadRepos(), loadCoreWindows()]).then(([ms, repos, windows]) => setData({ ms, repos, windows })).catch(e => setError(e.message));
  }, []);
  return { data, error };
}

export function releaseLinks(m: Milestone, repo?: Repo) {
  const sha = m.commits[0] ? shaOf(m.commits[0]) : "";
  return (
    <span className="flex flex-wrap gap-x-3 text-sm">
      {m.release_notes && <Link className="text-indigo-600 hover:underline" to={`/doc/${encodeURIComponent(m.release_notes)}`}>release notes</Link>}
      {sha && <Link className="text-indigo-600 hover:underline" to={`/commit/${m.repository}/${sha}?y=${m.date.slice(0, 4)}`}>commit {sha.slice(0, 8)}</Link>}
      {repo && <a className="text-indigo-600 hover:underline" href={githubTag(repo, m.tag)}>source at {m.tag}</a>}
    </span>
  );
}

const SW = 1000, SML = 12, SMR = 12, STRIP_H = 64;
const cardId = (m: Milestone) => `rel-${m.tag.replace(/[^\w.-]/g, "_")}`;

/** One tick per ZAP release, spaced by date; the keyboard moves between ticks with Tab, Enter or Space jumps to the card. */
function ReleaseStrip({ core, selected, onPick }: { core: Milestone[]; selected: string; onPick: (m: Milestone) => void }) {
  const [tip, setTip] = useState<Milestone | null>(null);
  const first = new Date(core[0].date), last = new Date(core[core.length - 1].date);
  const x = scaleUtc().domain([new Date(Date.UTC(first.getUTCFullYear(), 0, 1)), new Date(Date.UTC(last.getUTCFullYear() + 1, 0, 1))]).range([SML, SW - SMR]);
  const years = x.ticks(Math.min(14, last.getUTCFullYear() - first.getUTCFullYear() + 2)).filter(d => d.getUTCMonth() === 0 && x(d) < SW - 40);
  const major = (m: Milestone) => /\.0$/.test(m.version) || m.version.split(".").length === 2;
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-2" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${SW} ${STRIP_H}`} className="w-full h-auto select-none" role="group" aria-label="ZAP releases over time, one tick per release">
        <g className="text-slate-500" fill="currentColor" fontSize="11">
          {years.map(d => (
            <g key={d.getTime()}>
              <line x1={x(d)} x2={x(d)} y1={6} y2={STRIP_H - 16} stroke="currentColor" strokeOpacity={0.15} />
              <text x={x(d) + 3} y={STRIP_H - 3}>{d.getUTCFullYear()}</text>
            </g>
          ))}
        </g>
        <line x1={SML} x2={SW - SMR} y1={STRIP_H - 18} y2={STRIP_H - 18} stroke="currentColor" strokeOpacity={0.3} className="text-slate-400" />
        {core.map(m => {
          const cx = x(new Date(m.date)), on = selected === m.id || tip?.id === m.id, h = major(m) ? 30 : 18;
          return (
            <g key={m.id} role="button" tabIndex={0} aria-label={`${m.title}, ${day(m.date)}`} className="cursor-pointer outline-none focus-visible:[&>line]:stroke-[4]"
              onMouseEnter={() => setTip(m)} onFocus={() => setTip(m)} onBlur={() => setTip(null)} onClick={() => onPick(m)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(m); } }}>
              <rect x={cx - 5} y={4} width={10} height={STRIP_H - 20} fill="transparent" />
              <line x1={cx} x2={cx} y1={STRIP_H - 18} y2={STRIP_H - 18 - h} strokeWidth={on ? 4 : 2} className={on ? "text-amber-600" : "text-indigo-600"} stroke="currentColor" />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div role="tooltip" className="pointer-events-none absolute top-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 shadow"
          style={{ left: `${Math.min(80, Math.max(2, (x(new Date(tip.date)) / SW) * 100))}%` }}>
          <b>{tip.title}</b> · {day(tip.date)}
        </div>
      )}
    </div>
  );
}

function CoreCard({ m, prev, win, repo, hasNotes, selected }: { m: Milestone; prev?: Milestone; win?: CoreWindows[string]; repo?: Repo; hasNotes: boolean; selected: boolean }) {
  const days = prev ? Math.round((Date.parse(m.date) - Date.parse(prev.date)) / 864e5) : null;
  const sha = m.commits[0] ? shaOf(m.commits[0]) : "";
  return (
    <li id={cardId(m)} tabIndex={-1} style={{ scrollMarginTop: "calc(var(--hdr, 64px) + 3rem)" }}
      className={`rounded-xl border bg-white p-4 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selected ? "border-amber-600 ring-2 ring-amber-600" : "border-slate-200"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <Link className="text-3xl font-bold text-indigo-600 hover:underline" to={`/release/${encodeURIComponent(m.id)}`} aria-label={m.title}>{m.version}</Link>
        <span className="font-mono text-xs text-slate-500">{day(m.date)}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {days === null ? "The first release in the dataset" : <>{days.toLocaleString()} {days === 1 ? "day" : "days"} after {prev!.version}</>}
        {win && <> · {win.n.toLocaleString()} {win.n === 1 ? "commit" : "commits"} in this window</>}
      </p>
      {win && win.top.length > 0 && <p className="mt-1 text-sm text-slate-600">Top contributors: {win.top.map(([n, c]) => `${n} (${c})`).join(", ")}</p>}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {hasNotes && m.release_notes ? <Link className="text-indigo-600 hover:underline" to={`/doc/${encodeURIComponent(m.release_notes)}`}>release notes</Link>
          : <span className="text-slate-500">No release notes in the core help</span>}
        {sha && <Link className="text-indigo-600 hover:underline" to={`/commit/${m.repository}/${sha}?y=${m.date.slice(0, 4)}`}>commit {sha.slice(0, 8)}</Link>}
        {repo && <a className="text-indigo-600 hover:underline" href={githubTag(repo, m.tag)}>source at {m.tag}</a>}
      </div>
    </li>
  );
}

const yearOf = (m: Milestone) => day(m.date).slice(0, 4);
/** Sticky heading for a year; it sits under the site header. */
function YearHeading({ year, count }: { year: string; count: number }) {
  return <h2 className="sticky z-10 -mx-1 bg-slate-50 px-1 py-1 text-lg font-bold border-b border-slate-200" style={{ top: "var(--hdr, 64px)" }}>
    {year} <span className="text-sm font-normal text-slate-500">· {count.toLocaleString()} {count === 1 ? "release" : "releases"}</span></h2>;
}

export default function Releases() {
  const { data, error } = useReleases();
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "core-release";
  const q = (params.get("q") ?? "").toLowerCase();
  const repoFilter = params.get("repo") ?? "", from = params.get("from") ?? "", to = params.get("to") ?? ""; // `to` is exclusive
  const [shown, setShown] = useState(100);
  useEffect(() => setShown(100), [kind, q]);
  const [picked, setPicked] = useState("");                       // the ZAP release chosen on the strip
  useEffect(() => {                                               // keep sticky year headings under the site header
    const set = () => document.documentElement.style.setProperty("--hdr", `${document.querySelector("header")?.getBoundingClientRect().height ?? 64}px`);
    set(); window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);
  useEffect(() => {                                               // scroll once the card is on the page
    if (!picked) return;
    const el = document.getElementById(picked);
    if (el) { el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); el.focus({ preventScroll: true }); }
  }, [picked, kind, q]);

  const rows = useMemo(() => (data?.ms ?? [])
    .filter(m => m.kind === kind && (!q || m.title.toLowerCase().includes(q) || m.tag.toLowerCase().includes(q))
      && (!repoFilter || m.repository === repoFilter) && (!from || day(m.date) >= from) && (!to || day(m.date) < to))
    .sort((a, b) => b.date.localeCompare(a.date)), [data, kind, q, repoFilter, from, to]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const repoOf = (name: string) => data.repos.find(r => r.name === name);
  const core = data.ms.filter(m => m.kind === "core-release").sort((a, b) => a.date.localeCompare(b.date));
  const prevOf = new Map(core.map((m, i) => [m.id, core[i - 1]]));
  const withNotes = core.filter(m => m.release_notes).length;
  const years: { year: string; all: number; rows: Milestone[] }[] = [];
  const perYear = new Map<string, number>();
  rows.forEach(m => perYear.set(yearOf(m), (perYear.get(yearOf(m)) ?? 0) + 1));
  rows.slice(0, shown).forEach(m => {
    const y = yearOf(m);
    if (years[years.length - 1]?.year !== y) years.push({ year: y, all: perYear.get(y)!, rows: [] });
    years[years.length - 1].rows.push(m);
  });
  const pick = (m: Milestone) => {
    if (kind !== "core-release") set("kind", "");
    if (q || repoFilter || from || to) { const n = new URLSearchParams(params); ["q", "repo", "from", "to", "kind"].forEach(k => n.delete(k)); setParams(n, { replace: true }); }
    setShown(100);
    setPicked(cardId(m));
  };
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); v ? n.set(k, v) : n.delete(k); setParams(n, { replace: true }); };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Releases</h1>
      <p className="text-slate-600">
        Release tags from the repositories, with the commit each one points at and, for ZAP releases, the release notes in the
        core help. Weekly tags are not listed. Dates are tag dates (the tagged commit's date for lightweight tags), which for
        some early releases is later than the actual release.
      </p>
      <div className="flex flex-wrap gap-2" role="tablist">
        {KINDS.map(k => (
          <button key={k.id} role="tab" aria-selected={kind === k.id} onClick={() => set("kind", k.id === "core-release" ? "" : k.id)}
            className={`px-3 py-1 rounded text-sm border ${kind === k.id ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300"}`}>
            {k.label} ({(data.ms.filter(m => m.kind === k.id)).length})
          </button>
        ))}
      </div>
      <input type="search" placeholder="Filter by name or tag…" aria-label="Filter releases" value={params.get("q") ?? ""} onChange={e => set("q", e.target.value)}
        className="w-full md:w-80 rounded border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
      <p className="text-sm text-slate-500" aria-live="polite">
        {rows.length.toLocaleString()} releases, newest first
        {(repoFilter || from || to) && <> · {repoFilter}{from && <> from {from}</>}{to && <> to {to} (not including)</>}{" "}
          <button className="text-indigo-600 hover:underline" onClick={() => { const n = new URLSearchParams(params); ["repo", "from", "to"].forEach(k => n.delete(k)); setParams(n, { replace: true }); }}>Clear</button></>}
      </p>
      {kind === "core-release" && core.length > 0 && <ReleaseStrip core={core} selected={core.find(m => cardId(m) === picked)?.id ?? ""} onPick={pick} />}
      {kind === "core-release" && <p className="text-sm text-slate-500">{withNotes} of {core.length} ZAP releases have release notes in the core help; the others say so.</p>}
      {kind === "core-release" ? years.map(y => (
        <section key={y.year} aria-label={y.year} className="space-y-2">
          <YearHeading year={y.year} count={y.all} />
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {y.rows.map(m => <CoreCard key={m.id} m={m} prev={prevOf.get(m.id)} win={data.windows[m.id]} repo={repoOf(m.repository)} hasNotes={!!m.release_notes} selected={picked === cardId(m)} />)}
          </ul>
        </section>
      )) : years.map(y => (
        <section key={y.year} aria-label={y.year}>
          <YearHeading year={y.year} count={y.all} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sr-only"><tr><th>Date</th><th>Release</th><th>Links</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {y.rows.map(m => (
                  <tr key={m.id} className="align-top">
                    <td className="py-1 whitespace-nowrap font-mono text-xs">{day(m.date)}</td>
                    <td className="py-1 pl-4"><Link className="text-indigo-600 hover:underline" to={`/release/${encodeURIComponent(m.id)}`}>{m.title}</Link></td>
                    <td className="py-1 pl-4">{releaseLinks(m, repoOf(m.repository))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {rows.length > shown && (
        <button className="px-3 py-1 rounded text-sm border border-slate-300 bg-white text-slate-700" onClick={() => setShown(shown + 100)}>
          Show more ({rows.length - shown} remaining)
        </button>
      )}
    </div>
  );
}

export function ReleasePage() {
  const { id = "" } = useParams();
  const { data, error } = useReleases();
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const m = data.ms.find(x => x.id === id);
  if (!m) return <ErrorBox message={`Unknown release ${id}.`} />;
  const same = data.ms.filter(x => x.kind === m.kind && x.repository === m.repository && (x.addon ?? "") === (m.addon ?? ""))
    .sort((a, b) => a.date.localeCompare(b.date));
  const i = same.findIndex(x => x.id === id);
  const nav = (x: Milestone | undefined, label: string) => x && (
    <Link className="text-indigo-600 hover:underline" to={`/release/${encodeURIComponent(x.id)}`}>{label}: {x.title} ({day(x.date)})</Link>
  );
  return (
    <div className="space-y-4">
      <div className="text-sm"><Link to="/releases" className="text-indigo-600 hover:underline">← Releases</Link></div>
      <h1 className="text-2xl font-bold">{m.title}</h1>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-y-1 text-sm">
        <dt className="text-slate-500">Date</dt><dd>{new Date(m.date).toUTCString()}</dd>
        <dt className="text-slate-500">Repository</dt><dd>{m.repository}</dd>
        <dt className="text-slate-500">Tag</dt><dd className="font-mono text-xs break-all">{m.tag}</dd>
        {m.addon && (<><dt className="text-slate-500">Add-on</dt><dd><Link className="text-indigo-600 hover:underline" to={`/addon/${encodeURIComponent(m.addon)}`}>{m.addon.replace("addon:", "")}</Link></dd></>)}
        <dt className="text-slate-500">Links</dt><dd>{releaseLinks(m, data.repos.find(r => r.name === m.repository))}</dd>
      </dl>
      <div className="flex flex-col gap-1 text-sm">{nav(same[i - 1], "Previous")}{nav(same[i + 1], "Next")}</div>
    </div>
  );
}
