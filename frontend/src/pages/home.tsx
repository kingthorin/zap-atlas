import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { NAV } from "../components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui";
import { Commit, Milestone, Story, Timeline, loadAddons, loadCommits, loadDocs, loadHistoryIndex, loadManifest, loadMilestones, loadModules, loadRepos, loadStories, loadTimeline, loadCoreWindows, CoreWindows } from "../lib/data";

const day = (iso: string) => iso.slice(0, 10);
const nf = (n: number) => n.toLocaleString();
type Extra = { ms: Milestone[]; stories: Story[]; tl: Timeline; modules: number; windows: CoreWindows };

export default function Home() {
  const [repos, setRepos] = useState<any[]>([]);
  const [addons, setAddons] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [manifest, setManifest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [newest, setNewest] = useState<Commit | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [r, a, d, m] = await Promise.all([
          loadRepos(), loadAddons(), loadDocs(), loadManifest(),
        ]);
        setRepos(r); setAddons(a); setDocs(d); setManifest(m);
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {                                              // the extra panels load after the page shows
    Promise.all([loadMilestones(), loadStories(), loadTimeline(), loadModules(), loadCoreWindows()])
      .then(([ms, stories, tl, mods, windows]) => setExtra({ ms, stories, tl, modules: mods.length, windows })).catch(() => {});
    (async () => {                                               // the newest commit: the latest year's shard of each repository
      const ix = await loadHistoryIndex();
      const all = await Promise.all(Object.entries(ix).map(async ([repo, years]) => {
        const y = Object.keys(years).sort().pop();
        return y ? (await loadCommits(repo, y)).reduce<Commit | null>((a, c) => (!a || c.committer_date > a.committer_date ? c : a), null) : null;
      }));
      setNewest(all.reduce<Commit | null>((a, c) => (c && (!a || c.committer_date > a.committer_date) ? c : a), null));
    })().catch(() => {});
  }, []);

  if (loading) return <div className="p-4">Loading ecosystem…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">ZAP Atlas</h1>
        <p className="mt-2 text-slate-600">
          Interactive exploration of the ZAP ecosystem: core, add-ons, and
          documentation. All data is derived from pinned Git revisions — nothing
          is executed, no backend required.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Repositories" value={repos.length} />
        <StatCard label="Add-ons" value={addons.length} />
        <StatCard label="Help topics" value={docs.length} />
      </div>

      {extra && <Explore repos={repos.length} addons={addons.length} extra={extra} />}
      {extra && <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><Activity tl={extra.tl} /><Latest extra={extra} newest={newest} /></div>}
      {extra && <Featured stories={extra.stories} />}

      <div>
        <Card>
          <CardHeader><CardTitle>Generated at</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {manifest?.generated_at ? (
              <div className="text-slate-500">{new Date(manifest.generated_at).toUTCString()}</div>
            ) : (
              <span className="text-slate-400 italic">n/a</span>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-6 text-center">
        <div className="text-3xl font-bold text-indigo-600">{value}</div>
        <div className="text-sm text-slate-500 mt-2">{label}</div>
      </CardContent>
    </Card>
  );
}

/** One tile per page, each with a live number. */
function Explore({ extra, addons }: { repos: number; addons: number; extra: Extra }) {
  const core = extra.ms.filter(m => m.kind === "core-release").length;
  const commits = Object.values(extra.tl).reduce((a, months) => a + Object.values(months).reduce((b, r) => b + r[0], 0), 0);
  const reviewed = extra.stories.filter(s => s.status === "reviewed").length;
  const tiles: [string, string, string][] = [
    ["/timeline", "Timeline", `${nf(commits)} commits over time, with releases, stories and the core team.`],
    ["/graph", "Graph", `${nf(extra.modules)} modules and how they call each other; sweep through time.`],
    ["/releases", "Releases", `${core} ZAP releases and ${nf(extra.ms.length - core)} others, with commits and contributors per release.`],
    ["/stories", "Stories", `${extra.stories.length} evidence-backed stories (${reviewed} reviewed).`],
    ["/source", "Source", `Browse ${nf(extra.modules)} modules, types and their relationships; ${nf(addons)} add-ons.`],
    ["/search", "Search", "Everything at once; press Ctrl or Cmd + K anywhere. Start with a: to search only add-ons, or c: for commits."],
  ];
  return (
    <section aria-labelledby="explore-h" className="space-y-2">
      <h2 id="explore-h" className="text-xl font-semibold">Explore</h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tiles.map(([to, title, text]) => (
          <li key={to}><Link to={to} className="block h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-400">
            <span className="flex items-center gap-2 text-lg font-bold text-indigo-600">{(() => { const Icon: any = NAV.find(n => n.to === to)?.icon; return Icon && <Icon />; })()}{title}</span>
            <span className="mt-1 block text-sm text-slate-600">{text}</span>
          </Link></li>
        ))}
      </ul>
    </section>
  );
}

/** Commits per month across all repositories; opens the Timeline. */
function Activity({ tl }: { tl: Timeline }) {
  const pts = useMemo(() => {
    const m = new Map<string, number>();
    Object.values(tl).forEach(months => Object.entries(months).forEach(([k, r]) => m.set(k, (m.get(k) ?? 0) + r[0])));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tl]);
  if (!pts.length) return null;
  const W = 600, H = 120, P = 4, max = Math.max(...pts.map(p => p[1]));
  const idx = (k: string) => (+k.slice(0, 4) - +pts[0][0].slice(0, 4)) * 12 + +k.slice(5, 7) - +pts[0][0].slice(5, 7);
  const span = idx(pts[pts.length - 1][0]) || 1;
  const x = (k: string) => P + (idx(k) / span) * (W - 2 * P), y = (v: number) => H - 16 - (v / max) * (H - 24);
  const line = pts.map(([k, v]) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const total = pts.reduce((a, p) => a + p[1], 0);
  return (
    <Card>
      <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
      <CardContent>
        <Link to="/timeline" className="block text-indigo-600" aria-label={`Commits per month, ${pts[0][0]} to ${pts[pts.length - 1][0]}, ${nf(total)} in all, peak ${nf(max)} in a month. Open the Timeline.`}>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-hidden="true">
            <polygon points={`${x(pts[0][0])},${H - 16} ${line} ${x(pts[pts.length - 1][0])},${H - 16}`} fill="currentColor" fillOpacity={0.2} />
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} />
            <line x1={P} x2={W - P} y1={H - 16} y2={H - 16} stroke="currentColor" strokeOpacity={0.3} />
            <g className="text-slate-500" fill="currentColor" fontSize="11"><text x={P} y={H - 3}>{pts[0][0].slice(0, 4)}</text><text x={W - P} y={H - 3} textAnchor="end">{pts[pts.length - 1][0].slice(0, 4)}</text></g>
          </svg>
        </Link>
        <p className="mt-1 text-sm text-slate-600">Commits per month in all four repositories: {nf(total)} in all, peaking at {nf(max)} in a month. <Link to="/timeline" className="text-indigo-600 hover:underline">Open the Timeline</Link></p>
      </CardContent>
    </Card>
  );
}

function Latest({ extra, newest }: { extra: Extra; newest: Commit | null }) {
  const newer = (kind: string) => extra.ms.filter(m => m.kind === kind).reduce<Milestone | undefined>((a, m) => (!a || m.date > a.date ? m : a), undefined);
  const core = newer("core-release"), addon = newer("addon-release");
  const win = core && extra.windows[core.id];
  return (
    <Card>
      <CardHeader><CardTitle>Latest</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {core && <p>
          <span className="block text-slate-500">ZAP release</span>
          <Link className="text-indigo-600 hover:underline font-semibold" to={`/release/${encodeURIComponent(core.id)}`}>{core.title}</Link> ({day(core.date)})
          {win && <span className="block text-slate-600">{nf(win.n)} commits in its window; top contributors {win.top.map(t => t[0]).join(", ")}</span>}
        </p>}
        {addon && <p>
          <span className="block text-slate-500">Add-on release</span>
          <Link className="text-indigo-600 hover:underline font-semibold" to={`/release/${encodeURIComponent(addon.id)}`}>{addon.title}</Link> ({day(addon.date)})
        </p>}
        {newest && <p>
          <span className="block text-slate-500">Newest commit</span>
          <Link className="text-indigo-600 hover:underline font-semibold" to={`/commit/${newest.repository}/${newest.sha}?y=${newest.committer_date.slice(0, 4)}`}>{newest.subject}</Link>
          <span className="block text-slate-600">{newest.repository}, {day(newest.committer_date)}</span>
        </p>}
      </CardContent>
    </Card>
  );
}

/** Up to four reviewed stories, one per group first. */
function Featured({ stories }: { stories: Story[] }) {
  const reviewed = stories.filter(s => s.status === "reviewed").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const picks: Story[] = [];
  for (const g of ["history", "features", "projects"]) { const s = reviewed.find(r => r.group === g); if (s) picks.push(s); }
  reviewed.forEach(s => { if (picks.length < 4 && !picks.includes(s)) picks.push(s); });
  if (!picks.length) return null;
  return (
    <section aria-labelledby="featured-h" className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="featured-h" className="text-xl font-semibold">Featured stories</h2>
        <Link to="/stories" className="text-sm text-indigo-600 hover:underline">Browse all {stories.length}</Link>
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {picks.map(s => (
          <li key={s.id}><Link to={`/stories/${s.id.split(":").pop()}`} className="block h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-400">
            <span className="text-xs text-slate-500">{s.date} · {s.chapters.length} chapters</span>
            <span className="block text-lg font-bold">{s.title}</span>
            <span className="mt-1 block text-sm text-slate-600 line-clamp-3">{s.description}</span>
          </Link></li>
        ))}
      </ul>
    </section>
  );
}
