import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Milestone, Repo, githubTag, loadMilestones, loadRepos, shaOf } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

const KINDS: { id: string; label: string }[] = [
  { id: "core-release", label: "ZAP releases" },
  { id: "addon-release", label: "Add-on releases" },
  { id: "hud-release", label: "HUD releases" },
  { id: "extensions-release", label: "Early zap-extensions releases" },
];
const day = (iso: string) => iso.slice(0, 10);

function useReleases() {
  const [data, setData] = useState<{ ms: Milestone[]; repos: Repo[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([loadMilestones(), loadRepos()]).then(([ms, repos]) => setData({ ms, repos })).catch(e => setError(e.message));
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

export default function Releases() {
  const { data, error } = useReleases();
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "core-release";
  const q = (params.get("q") ?? "").toLowerCase();
  const [shown, setShown] = useState(100);
  useEffect(() => setShown(100), [kind, q]);

  const rows = useMemo(() => (data?.ms ?? [])
    .filter(m => m.kind === kind && (!q || m.title.toLowerCase().includes(q) || m.tag.toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date)), [data, kind, q]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const repoOf = (name: string) => data.repos.find(r => r.name === name);
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
      <p className="text-sm text-slate-500" aria-live="polite">{rows.length.toLocaleString()} releases, newest first</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="pb-2">Date</th><th className="pb-2 pl-4">Release</th><th className="pb-2 pl-4">Links</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, shown).map(m => (
              <tr key={m.id} className="align-top">
                <td className="py-1 whitespace-nowrap font-mono text-xs">{day(m.date)}</td>
                <td className="py-1 pl-4"><Link className="text-indigo-600 hover:underline" to={`/release/${encodeURIComponent(m.id)}`}>{m.title}</Link></td>
                <td className="py-1 pl-4">{releaseLinks(m, repoOf(m.repository))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
        <dt className="text-slate-500">Date</dt><dd>{new Date(m.date).toUTCString()}</dd>
        <dt className="text-slate-500">Repository</dt><dd>{m.repository}</dd>
        <dt className="text-slate-500">Tag</dt><dd className="font-mono text-xs">{m.tag}</dd>
        {m.addon && (<><dt className="text-slate-500">Add-on</dt><dd><Link className="text-indigo-600 hover:underline" to={`/addon/${encodeURIComponent(m.addon)}`}>{m.addon.replace("addon:", "")}</Link></dd></>)}
        <dt className="text-slate-500">Links</dt><dd>{releaseLinks(m, data.repos.find(r => r.name === m.repository))}</dd>
      </dl>
      <div className="flex flex-col gap-1 text-sm">{nav(same[i - 1], "Previous")}{nav(same[i + 1], "Next")}</div>
    </div>
  );
}
