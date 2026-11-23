import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AddOn, Module, ModuleGraph, Relationship, Symbol, filePathOf, isDeprecated, loadAddons, loadModuleGraph,
  loadModuleRelationships, loadModuleSymbols, loadModules,
} from "../lib/data";
import { routeForEntity } from "../lib/routes";
import { Loading, ErrorBox } from "../components/ui";

type Tab = "symbols" | "rels" | "links" | "deps";
const TABS: [Tab, string][] = [["links", "Module links"], ["symbols", "Symbols"], ["rels", "Relationships"], ["deps", "Add-on dependencies"]];
const TYPE_KINDS = new Set(["class", "interface", "enum", "record", "annotation_type"]);
const EVIDENCE = ["resolved", "inferred", "syntactic"];
const PAGE = 100;

const chip = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300"}`;

function label(id: string): string {
  const p = id.split(":");
  return p[0] === "file" ? p.slice(3).join(":") : p.slice(2).join(":") || id;
}
function Entity({ id }: { id: string }) {
  const to = id.startsWith("file:") ? null : routeForEntity(id);
  return to ? <Link className="text-indigo-600 hover:underline break-all" to={to}>{label(id)}</Link> : <span className="break-all">{label(id)}</span>;
}

/* ---------- directory tree of one module, built from its symbols' files ---------- */
interface DirNode { name: string; path: string; files: number; kids: DirNode[] }

function buildTree(modPath: string, symbols: Symbol[]): DirNode {
  const root: DirNode = { name: modPath, path: modPath, files: 0, kids: [] };
  const seen = new Set<string>();
  for (const s of symbols) {
    const file = filePathOf(s.file);
    if (!seen.has(file)) {
      seen.add(file);
      let node = root;
      const parts = file.slice(modPath.length + 1).split("/").slice(0, -1);
      node.files++;
      for (const part of parts) {
        const path = `${node.path}/${part}`;
        let kid = node.kids.find(k => k.path === path);
        if (!kid) node.kids.push(kid = { name: part, path, files: 0, kids: [] });
        kid.files++; node = kid;
      }
    }
  }
  // Collapse chains of single-child directories (src/main/java/org/...) into one row.
  const squash = (n: DirNode): DirNode => {
    while (n.kids.length === 1 && n.kids[0].files === n.files) { const k = n.kids[0]; n = { ...k, name: `${n.name}/${k.name}` }; }
    return { ...n, kids: n.kids.map(squash).sort((a, b) => a.name.localeCompare(b.name)) };
  };
  const out = squash(root); out.name = modPath;
  return out;
}

function DirRow({ node, dir, pick, depth }: { node: DirNode; dir: string; pick: (p: string) => void; depth: number }) {
  const [open, setOpen] = useState(depth < 1 || dir.startsWith(node.path + "/"));
  const active = dir === node.path;
  return (
    <li>
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
        {node.kids.length > 0
          ? <button className="w-4 text-slate-400" aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>
          : <span className="w-4" />}
        <button className={`truncate text-left ${active ? "font-semibold text-indigo-700" : "text-slate-700 hover:underline"}`} title={node.path} onClick={() => pick(node.path)}>{node.name}</button>
        <span className="text-slate-400 ml-auto pr-1">{node.files}</span>
      </div>
      {open && node.kids.length > 0 && <ul>{node.kids.map(k => <DirRow key={k.path} node={k} dir={dir} pick={pick} depth={depth + 1} />)}</ul>}
    </li>
  );
}

/* ---------- right-hand tabs ---------- */
function SymbolsTab({ symbols, dir, base }: { symbols: Symbol[]; dir: string; base: string }) {
  const [q, setQ] = useState("");
  const [typesOnly, setTypesOnly] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const dq = useDeferredValue(q.trim().toLowerCase());
  const rows = useMemo(() => symbols
    .filter(s => (!typesOnly || TYPE_KINDS.has(s.kind)) && (!dq || s.qualified_name.toLowerCase().includes(dq)) && filePathOf(s.file).startsWith(dir))
    .sort((a, b) => filePathOf(a.file).localeCompare(filePathOf(b.file)) || a.start_line - b.start_line), [symbols, typesOnly, dq, dir]);
  useEffect(() => setShown(PAGE), [dq, typesOnly, dir]);
  let last = "";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input type="search" placeholder="Filter symbols…" aria-label="Filter symbols" value={q} onChange={e => setQ(e.target.value)}
          className="w-full md:w-72 rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
        <label className="text-slate-600"><input type="checkbox" checked={typesOnly} onChange={e => setTypesOnly(e.target.checked)} /> Types only</label>
        <span className="text-slate-500" aria-live="polite">{rows.length.toLocaleString()} symbols</span>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm border-collapse">
        <thead><tr className="text-left text-slate-500 border-b border-slate-200">
          <th className="pb-1 w-24">Kind</th><th className="pb-1">Symbol</th><th className="pb-1 pl-3">File</th><th className="pb-1 pl-3 text-right">Lines</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, shown).map(s => {
            const file = filePathOf(s.file), first = file !== last; last = file;
            return (
              <tr key={s.id} className={`hover:bg-slate-50 ${first ? "border-t border-slate-100" : ""}`}>
                <td className="py-0.5 pr-3 text-xs text-slate-400 whitespace-nowrap">{s.kind}</td>
                <td className="py-0.5 break-all">
                  <Link className="text-indigo-600 hover:underline" to={`/symbol/${encodeURIComponent(s.id)}`}>{s.signature}</Link>
                  {isDeprecated(s) && <span className="ml-2 px-1 rounded bg-amber-100 text-amber-800 text-xs">deprecated</span>}
                </td>
                <td className="py-0.5 pl-3 font-mono text-[11px] text-slate-500 break-all" title={file}>{first ? file.slice(base.length).replace(/^\/?(src\/)?(main\/java\/)?/, "") : ""}</td>
                <td className="py-0.5 pl-3 text-xs text-slate-500 whitespace-nowrap text-right">{s.start_line}-{s.end_line}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {rows.length > shown && <button className={chip(false)} onClick={() => setShown(shown + PAGE)}>Show more ({(rows.length - shown).toLocaleString()} remaining)</button>}
    </div>
  );
}

function RelationshipsTab({ rels, dir }: { rels: Relationship[]; dir: string }) {
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [evidence, setEvidence] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const dq = useDeferredValue(q.trim().toLowerCase());
  const inDir = useMemo(() => rels.filter(r => !r.source_file || r.source_file.startsWith(dir)), [rels, dir]);
  const typeCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of inDir) c.set(r.type, (c.get(r.type) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [inDir]);
  const filtered = useMemo(() => inDir.filter(r =>
    (!types.size || types.has(r.type)) && (!evidence.size || evidence.has(r.evidence_type)) &&
    (!dq || r.source.toLowerCase().includes(dq) || r.target.toLowerCase().includes(dq))), [inDir, types, evidence, dq]);
  useEffect(() => setPage(0), [types, evidence, dq, dir]);
  const toggle = (set: Set<string>, v: string, put: (s: Set<string>) => void) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); put(n); };
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input type="search" placeholder="Filter by source or target…" aria-label="Filter relationships" value={q} onChange={e => setQ(e.target.value)}
          className="w-full md:w-72 rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
        <span className="text-slate-500" aria-live="polite">{filtered.length.toLocaleString()} of {inDir.length.toLocaleString()} relationships</span>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Relationship type">
        {typeCounts.map(([t, n]) => <button key={t} aria-pressed={types.has(t)} className={chip(types.has(t))} onClick={() => toggle(types, t, setTypes)}>{t} ({n.toLocaleString()})</button>)}
      </div>
      <div className="flex flex-wrap gap-1 items-center" role="group" aria-label="Evidence">
        <span className="text-xs text-slate-500">Evidence:</span>
        {EVIDENCE.map(e => <button key={e} aria-pressed={evidence.has(e)} className={chip(evidence.has(e))} onClick={() => toggle(evidence, e, setEvidence)}>{e}</button>)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead><tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="pb-1">Source</th><th className="pb-1 pl-3">Type</th><th className="pb-1 pl-3">Target</th><th className="pb-1 pl-3">Evidence</th><th className="pb-1 pl-3">File:Line</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.slice(page * PAGE, (page + 1) * PAGE).map((r, i) => (
              <tr key={`${r.source}|${r.target}|${r.type}|${i}`} className="align-top">
                <td className="py-0.5 max-w-[28%]"><Entity id={r.source} /></td>
                <td className="py-0.5 pl-3 whitespace-nowrap">{r.type}</td>
                <td className="py-0.5 pl-3 max-w-[28%]"><Entity id={r.target} /></td>
                <td className="py-0.5 pl-3 text-slate-500">{r.evidence_type}</td>
                <td className="py-0.5 pl-3 text-[11px] font-mono text-slate-500 break-all">{r.source_file || "—"}{r.source_line != null ? `:${r.source_line}` : ""}</td>
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
    </div>
  );
}

/** Edges between modules, from module_graph.json: all modules ranked, or one module's neighbours. */
function LinksTab({ graph, selected, pick }: { graph: ModuleGraph; selected: string; pick: (moduleId: string) => void }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const by = new Map<string, { out: number; inc: number; types: Map<string, number> }>();
    const get = (id: string) => by.get(id) ?? by.set(id, { out: 0, inc: 0, types: new Map() }).get(id)!;
    for (const [s, t, type, n] of graph.edges) {
      const a = graph.nodes[s], b = graph.nodes[t];
      if (selected && a !== selected && b !== selected) continue;
      if (selected) {
        const other = get(a === selected ? b : a);
        a === selected ? (other.out += n) : (other.inc += n);
        other.types.set(type, (other.types.get(type) ?? 0) + n);
      } else { get(a).out += n; get(b).inc += n; get(a).types.set(type, (get(a).types.get(type) ?? 0) + n); }
    }
    return [...by.entries()].map(([id, v]) => ({ id, ...v })).sort((x, y) => (y.out + y.inc) - (x.out + x.inc));
  }, [graph, selected]);
  const term = q.trim().toLowerCase();
  const shown = rows.filter(r => !term || r.id.toLowerCase().includes(term));
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        {selected
          ? <>Modules linked to <b>{label(selected)}</b> by calls, imports, inheritance and API use. “Out” counts edges from this module, “In” edges to it.</>
          : <>Every module ranked by edges to and from other modules (calls, imports, inheritance, API use, dependencies). Pick a module to see its neighbours.</>}
      </p>
      <div className="flex gap-3 items-center text-sm">
        <input type="search" placeholder="Filter modules…" aria-label="Filter modules" value={q} onChange={e => setQ(e.target.value)}
          className="w-full md:w-72 rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
        <span className="text-slate-500" aria-live="polite">{shown.length} modules</span>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm border-collapse">
        <thead><tr className="text-left text-slate-500 border-b border-slate-200">
          <th className="pb-1">Module</th><th className="pb-1 text-right">Out</th><th className="pb-1 text-right pl-3">In</th><th className="pb-1 pl-4">Edge types</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {shown.map(r => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="py-0.5"><button className="text-indigo-600 hover:underline text-left" onClick={() => pick(r.id)}>{label(r.id)}</button> <span className="text-xs text-slate-400">{r.id.split(":")[1]}</span></td>
              <td className="py-0.5 text-right tabular-nums">{r.out.toLocaleString()}</td>
              <td className="py-0.5 text-right tabular-nums pl-3">{r.inc.toLocaleString()}</td>
              <td className="py-0.5 pl-4 text-xs text-slate-500">{[...r.types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function DepsTab() {
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
    .sort((x, y) => sort === "name" ? x.a.name.localeCompare(y.a.name) : sort === "deps" ? y.deps.length - x.deps.length : y.usedBy.length - x.usedBy.length);
  const name = (id: string, known: Set<string>) => known.has(id)
    ? <Link key={id} className="text-indigo-600 hover:underline mr-2" to={`/addon/${encodeURIComponent(id)}`}>{id.replace("addon:", "")}</Link>
    : <span key={id} className="text-slate-400 mr-2" title="not in this dataset">{id.replace("addon:", "")}</span>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">Add-on dependencies declared in each add-on's Gradle build. Names in grey are not add-ons of this dataset. <Link className="text-indigo-600" to="/graph?view=deps">Show them as a network</Link>.</p>
      <div className="flex flex-wrap gap-3 items-center text-sm">
        <input type="search" placeholder="Filter add-ons…" aria-label="Filter add-ons" value={q} onChange={e => setQ(e.target.value)}
          className="w-full md:w-72 rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
        <label>Sort by{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={sort} onChange={e => setSort(e.target.value as any)}>
            <option value="usedBy">most required by others</option><option value="deps">most dependencies</option><option value="name">name</option>
          </select>
        </label>
        <span aria-live="polite" className="text-slate-500">{shown.length} add-ons</span>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm border-collapse">
        <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="pb-1">Add-on</th><th className="pb-1 pl-4">Depends on</th><th className="pb-1 pl-4">Required by</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {shown.map(({ a, deps, usedBy, known }) => (
            <tr key={a.id} className="align-top">
              <td className="py-0.5 pr-4 whitespace-nowrap">{name(a.id, known)}<span className="text-xs text-slate-400">{a.status}</span></td>
              <td className="py-0.5 pl-4"><span className="text-xs text-slate-400 mr-2">{deps.length}</span>{deps.map(d => name(d, known))}</td>
              <td className="py-0.5 pl-4"><span className="text-xs text-slate-400 mr-2">{usedBy.length}</span>{usedBy.map(d => name(d, known))}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

/* ---------- page ---------- */
export default function Code() {
  const [params, setParams] = useSearchParams();
  const repo = params.get("repo") ?? "", mod = params.get("mod") ?? "", dir = params.get("dir") ?? "";
  const tab = (params.get("tab") as Tab) || "links";
  const [modules, setModules] = useState<Module[] | null>(null);
  const [graph, setGraph] = useState<ModuleGraph | null>(null);
  const [symbols, setSymbols] = useState<Symbol[] | null>(null);
  const [rels, setRels] = useState<Relationship[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([loadModules(), loadModuleGraph()]).then(([m, g]) => { setModules(m); setGraph(g); }).catch(e => setError(e.message));
  }, []);

  // Symbols and relationships are sharded per module: fetch only the selected module's shards.
  useEffect(() => {
    setSymbols(null); setRels(null);
    if (!repo || !mod) return;
    loadModuleSymbols(repo, mod).then(setSymbols).catch(e => setError(e.message));
    loadModuleRelationships(repo, mod).then(setRels).catch(e => setError(e.message));
  }, [repo, mod]);

  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const pickModule = (r: string, path: string) => set({ repo: r, mod: path, dir: "", tab: tab === "links" || tab === "deps" ? tab : "symbols" });
  const pickModuleId = (id: string) => { const [, r, ...rest] = id.split(":"); pickModule(r, rest.join(":")); };
  const tree = useMemo(() => (symbols && mod ? buildTree(mod, symbols) : null), [symbols, mod]);

  const byRepo = useMemo(() => {
    const out = new Map<string, Module[]>();
    const term = filter.trim().toLowerCase();
    for (const m of [...(modules ?? [])].sort((a, b) => a.path.localeCompare(b.path)))
      if (!term || m.path.toLowerCase().includes(term) || m.id === `module:${repo}:${mod}`) (out.get(m.repository) ?? out.set(m.repository, []).get(m.repository)!).push(m);
    return out;
  }, [modules, filter, repo, mod]);

  if (error) return <ErrorBox message={error} />;
  if (!modules || !graph) return <Loading />;
  const selected = mod ? `module:${repo}:${mod}` : "";

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-bold">Source and architecture</h1>
        <p className="text-sm text-slate-600">
          Pick a module to browse its directories, symbols and relationships; with nothing selected, see how modules and add-ons depend on each other.
          Edges are <b>resolved</b> (follow from the source), <b>inferred</b> (several candidates) or <b>syntactic</b> (read from the code, not resolved).
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4 items-start">
        <nav aria-label="Modules and directories" className="rounded-xl border border-slate-200 bg-white p-2 text-sm lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)] overflow-y-auto">
          <input type="search" placeholder="Filter modules…" aria-label="Filter module tree" value={filter} onChange={e => setFilter(e.target.value)}
            className="w-full mb-2 rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
          {selected && <button className="mb-2 text-xs text-indigo-600 hover:underline" onClick={() => set({ repo: "", mod: "", dir: "", tab: "links" })}>Clear selection</button>}
          {[...byRepo.entries()].map(([r, mods]) => (
            <details key={r} open={!!filter || r === repo || byRepo.size === 1 || mods.length <= 5}>
              <summary className="cursor-pointer font-semibold py-0.5">{r} <span className="font-normal text-slate-400">({mods.length})</span></summary>
              <ul className="ml-2">
                {mods.map(m => {
                  const on = m.repository === repo && m.path === mod;
                  return (
                    <li key={m.id}>
                      <button className={`w-full text-left truncate py-0.5 ${on ? "font-semibold text-indigo-700" : "text-slate-700 hover:underline"}`}
                        title={m.path} aria-current={on ? "true" : undefined} onClick={() => pickModule(m.repository, m.path)}>{m.path}</button>
                      {on && tree && <ul className="ml-1 border-l border-slate-200 text-xs">
                        <DirRow node={tree} dir={dir} pick={d => set({ dir: d === mod ? "" : d, tab: tab === "links" || tab === "deps" ? "symbols" : tab })} depth={0} />
                      </ul>}
                      {on && !tree && <div className="ml-3 text-xs text-slate-400 italic">loading…</div>}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </nav>
        <section aria-label="Details" className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="tablist">
              {TABS.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={chip(tab === t)} onClick={() => set({ tab: t })}>{l}</button>)}
            </div>
            {selected && (
              <span className="text-sm text-slate-600 ml-auto">
                <b>{mod}</b>{dir && dir !== mod && <> › <span className="font-mono text-xs">{dir.slice(mod.length + 1)}</span></>} ·{" "}
                <Link className="text-indigo-600 hover:underline" to={`/module/${repo}/${mod}`}>module page</Link>
              </span>
            )}
          </div>
          {tab === "links" && <LinksTab graph={graph} selected={selected} pick={pickModuleId} />}
          {tab === "deps" && <DepsTab />}
          {(tab === "symbols" || tab === "rels") && (
            !selected ? <p className="text-sm italic text-slate-500">Select a module in the tree.</p>
            : tab === "symbols" ? (symbols ? <SymbolsTab symbols={symbols} dir={dir || mod} base={mod} /> : <Loading />)
            : (rels ? <RelationshipsTab rels={rels} dir={dir || mod} /> : <Loading />)
          )}
        </section>
      </div>
    </div>
  );
}
