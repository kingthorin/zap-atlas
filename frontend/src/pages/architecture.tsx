import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AddOn, Relationship, loadAddons, loadRepoRelationships, loadRepos } from "../lib/data";
import { routeForEntity } from "../lib/routes";
import { Loading, ErrorBox } from "../components/ui";

const PAGE = 100;
const EVIDENCE = ["resolved", "inferred", "syntactic"];

/** Readable form of an entity id: drops the kind and repository prefix, shows file paths for file ids. */
function label(id: string): string {
  const p = id.split(":");
  return p[0] === "file" ? p.slice(3).join(":") : p.slice(2).join(":") || id;
}

function Entity({ id }: { id: string }) {
  const to = id.startsWith("file:") ? null : routeForEntity(id);
  return to ? <Link className="text-indigo-600 hover:underline break-all" to={to}>{label(id)}</Link> : <span className="break-all">{label(id)}</span>;
}

const chip = (on: boolean) =>
  `px-3 py-1 rounded text-sm border ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300"}`;

function Relationships() {
  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState("");
  const [rels, setRels] = useState<Relationship[] | null>(null);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [evidence, setEvidence] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const dq = useDeferredValue(q.trim().toLowerCase());

  useEffect(() => {
    loadRepos().then(r => { const n = r.map(x => x.name); setRepos(n); setRepo(n[0] ?? ""); }).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (!repo) return;
    setRels(null); setTypes(new Set()); setEvidence(new Set()); setQ(""); setPage(0);
    loadRepoRelationships(repo).then(setRels).catch(e => setError(e.message));
  }, [repo]);

  const typeCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rels ?? []) c.set(r.type, (c.get(r.type) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [rels]);
  const filtered = useMemo(() => (rels ?? []).filter(r =>
    (!types.size || types.has(r.type)) && (!evidence.size || evidence.has(r.evidence_type)) &&
    (!dq || r.source.toLowerCase().includes(dq) || r.target.toLowerCase().includes(dq))), [rels, types, evidence, dq]);
  useEffect(() => setPage(0), [types, evidence, dq]);

  const toggle = (set: Set<string>, v: string, put: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); put(n);
  };
  if (error) return <ErrorBox message={error} />;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center text-sm">
        <label>Repository{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={repo} onChange={e => setRepo(e.target.value)}>
            {repos.map(r => <option key={r}>{r}</option>)}
          </select>
        </label>
        <input type="search" placeholder="Filter by source or target…" aria-label="Filter relationships" value={q} onChange={e => setQ(e.target.value)}
          className="w-full md:w-80 rounded border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
      </div>
      {!rels ? <Loading /> : (<>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Relationship type">
          {typeCounts.map(([t, n]) => (
            <button key={t} aria-pressed={types.has(t)} className={chip(types.has(t))} onClick={() => toggle(types, t, setTypes)}>{t} ({n.toLocaleString()})</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center" role="group" aria-label="Evidence">
          <span className="text-sm text-slate-500">Evidence:</span>
          {EVIDENCE.map(e => <button key={e} aria-pressed={evidence.has(e)} className={chip(evidence.has(e))} onClick={() => toggle(evidence, e, setEvidence)}>{e}</button>)}
          {(types.size > 0 || evidence.size > 0 || q) && (
            <button className="text-sm text-indigo-600 hover:underline" onClick={() => { setTypes(new Set()); setEvidence(new Set()); setQ(""); }}>Clear filters</button>
          )}
        </div>
        <p className="text-sm text-slate-500" aria-live="polite">{filtered.length.toLocaleString()} of {rels.length.toLocaleString()} relationships</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="pb-2">Source</th><th className="pb-2 pl-4">Type</th><th className="pb-2 pl-4">Target</th>
              <th className="pb-2 pl-4">Evidence</th><th className="pb-2 pl-4">File:Line</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.slice(page * PAGE, (page + 1) * PAGE).map((r, i) => (
                <tr key={`${r.source}|${r.target}|${r.type}|${i}`} className="align-top">
                  <td className="py-1 max-w-[28%]"><Entity id={r.source} /></td>
                  <td className="py-1 pl-4 whitespace-nowrap">{r.type}</td>
                  <td className="py-1 pl-4 max-w-[28%]"><Entity id={r.target} /></td>
                  <td className="py-1 pl-4 text-slate-500">{r.evidence_type}</td>
                  <td className="py-1 pl-4 text-[11px] font-mono text-slate-500 break-all">{r.source_file || "—"}{r.source_line != null ? `:${r.source_line}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button className={chip(false)} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {pages.toLocaleString()}</span>
          <button className={chip(false)} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </>)}
    </div>
  );
}

function Dependencies() {
  const [addons, setAddons] = useState<AddOn[] | null>(null);
  const [sort, setSort] = useState<"name" | "deps" | "usedBy">("usedBy");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { loadAddons().then(setAddons).catch(e => setError(e.message)); }, []);

  const rows = useMemo(() => {
    const known = new Set((addons ?? []).map(a => a.id));
    const usedBy = new Map<string, string[]>();
    for (const a of addons ?? []) for (const d of a.dependencies) (usedBy.get(d) ?? usedBy.set(d, []).get(d)!).push(a.id);
    return (addons ?? []).map(a => ({ a, deps: a.dependencies, usedBy: usedBy.get(a.id) ?? [], known }));
  }, [addons]);

  if (error) return <ErrorBox message={error} />;
  if (!addons) return <Loading />;
  const term = q.trim().toLowerCase();
  const shown = rows.filter(r => !term || r.a.name.toLowerCase().includes(term) || r.a.id.toLowerCase().includes(term))
    .sort((x, y) => sort === "name" ? x.a.name.localeCompare(y.a.name)
      : sort === "deps" ? y.deps.length - x.deps.length : y.usedBy.length - x.usedBy.length);
  const name = (id: string, known: Set<string>) => known.has(id)
    ? <Link key={id} className="text-indigo-600 hover:underline mr-2" to={`/addon/${encodeURIComponent(id)}`}>{id.replace("addon:", "")}</Link>
    : <span key={id} className="text-slate-400 mr-2" title="not in this dataset">{id.replace("addon:", "")}</span>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Add-on dependencies declared in each add-on's Gradle build (<code>dependencies &#123; addOns &#123; … &#125; &#125;</code>).
        Names in grey are not add-ons of this dataset.</p>
      <div className="flex flex-wrap gap-4 items-center text-sm">
        <input type="search" placeholder="Filter add-ons…" aria-label="Filter add-ons" value={q} onChange={e => setQ(e.target.value)}
          className="w-full md:w-72 rounded border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
        <label>Sort by{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={sort} onChange={e => setSort(e.target.value as any)}>
            <option value="usedBy">most required by others</option><option value="deps">most dependencies</option><option value="name">name</option>
          </select>
        </label>
        <span aria-live="polite" className="text-slate-500">{shown.length} add-ons</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead><tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="pb-2">Add-on</th><th className="pb-2 pl-4">Depends on</th><th className="pb-2 pl-4">Required by</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map(({ a, deps, usedBy, known }) => (
              <tr key={a.id} className="align-top">
                <td className="py-1 pr-4 whitespace-nowrap">{name(a.id, known)}<span className="text-xs text-slate-400">{a.status}</span></td>
                <td className="py-1 pl-4"><span className="text-xs text-slate-400 mr-2">{deps.length}</span>{deps.map(d => name(d, known))}</td>
                <td className="py-1 pl-4"><span className="text-xs text-slate-400 mr-2">{usedBy.length}</span>{usedBy.map(d => name(d, known))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Architecture() {
  const [tab, setTab] = useState<"rels" | "deps">("rels");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Architecture explorer</h1>
      <p className="text-slate-600">
        Evidence-aware relationships. Each edge records its type, repository, source file and line, and how it was
        established: <b>resolved</b> (follows from the source), <b>inferred</b> (several candidates), or
        <b> syntactic</b> (read from the code, not resolved to a declaration).
      </p>
      <div className="flex gap-2" role="tablist">
        <button role="tab" aria-selected={tab === "rels"} className={chip(tab === "rels")} onClick={() => setTab("rels")}>Code and docs relationships</button>
        <button role="tab" aria-selected={tab === "deps"} className={chip(tab === "deps")} onClick={() => setTab("deps")}>Add-on dependencies</button>
      </div>
      {tab === "rels" ? <Relationships /> : <Dependencies />}
    </div>
  );
}
