import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import {
  ModuleGraph, Relationship, ShardIndex, loadModuleGraph, loadModuleIncoming, loadModuleRelationships, loadModuleSymbols, loadShardIndex,
} from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

const REPO_COLOR: Record<string, string> = { zaproxy: "#4389ff", "zap-extensions": "#e08e00", "zap-core-help": "#2f9e6f", "zap-hud": "#8e5bd0" };
const TYPES = ["CALLS", "IMPORTS", "EXTENDS", "IMPLEMENTS", "USES_API", "DEPENDS_ON"];
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isDark = () => document.documentElement.classList.contains("dark");

/** Sigma's own hover box is always white, which hides a light label in the dark theme, so draw one that follows the theme. */
function drawHover(ctx: CanvasRenderingContext2D, data: any, settings: any) {
  const dark = isDark(), size = settings.labelSize;
  ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  ctx.save();
  ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowBlur = 8; ctx.shadowColor = dark ? "#000" : "#00000066";
  ctx.fillStyle = dark ? "#1e293b" : "#fff";
  if (typeof data.label === "string") {
    const w = ctx.measureText(data.label).width + 8, h = size + 8, x = data.x + data.size + 3;
    ctx.fillRect(x, data.y - h / 2, w, h);
  }
  ctx.beginPath(); ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2); ctx.closePath(); ctx.fill();
  ctx.restore();
  if (typeof data.label === "string") {
    ctx.fillStyle = dark ? "#e2e8f0" : "#334155";
    ctx.fillText(data.label, data.x + data.size + 7, data.y + size / 3);
  }
}

const repoOf = (id: string) => id.split(":")[1];
const pathOf = (id: string) => id.split(":").slice(2).join(":");
const short = (id: string) => (repoOf(id) === "zaproxy" ? `${pathOf(id)} (core)` : pathOf(id).replace(/^addOns\//, ""));

const TYPE_KINDS = new Set(["class", "interface", "enum", "record", "annotation_type"]);
const CODE_EDGES = new Set(["CALLS", "IMPORTS", "EXTENDS", "IMPLEMENTS"]); // edges that expanding a module replaces with type-level ones
const TOP_TYPES = 40; // most connected types shown per expanded module

interface Detail { types: string[]; rels: Relationship[]; total: number }
const ownerType = (id: string) => id.split("#")[0];
const labelOf = (id: string) => (id.startsWith("module:") ? short(id) : ownerType(id).split(":").slice(2).join(":").split(".").pop()!);
const lighten = (hex: string) => hex + "99";

interface Pair { a: string; b: string; weight: number; types: Record<string, number>; ab: number; ba: number }

/**
 * Pairs for the graph with some modules expanded: their module-level code edges are replaced by edges
 * between their most connected types and the types or modules on the other side.
 */
function expandedPairs(g: ModuleGraph, types: Set<string>, expanded: string[], detail: Map<string, Detail>,
                       indexes: Record<string, ShardIndex>): { pairs: Pair[]; typeParent: Map<string, string> } {
  const open = new Set(expanded.filter(m => detail.has(m)));
  const typeParent = new Map<string, string>();
  for (const m of open) for (const t of detail.get(m)!.types) typeParent.set(t, m);
  const modulesOf = new Map<string, string[]>();
  for (const n of g.nodes) (modulesOf.get(repoOf(n)) ?? modulesOf.set(repoOf(n), []).get(repoOf(n))!).push(pathOf(n));
  const moduleOf = (symbol: string): string | null => {
    const [, repo, ...rest] = ownerType(symbol).split(":"), ix = indexes[repo];
    const at = ix?.s[rest.join(":")];
    if (at === undefined) return null;
    const key = ix.keys[at];
    const best = (modulesOf.get(repo) ?? []).filter(p => key === p || key.startsWith(p + "/")).sort((a, b) => b.length - a.length)[0];
    return best ? `module:${repo}:${best}` : null;
  };
  const nodeFor = (symbol: string) => { const t = ownerType(symbol); return typeParent.has(t) ? t : moduleOf(symbol); };

  const by = new Map<string, Pair>();
  const add = (x: string, y: string, type: string, n: number) => {
    if (x === y) return;
    const flip = x > y, key = flip ? `${y}|${x}` : `${x}|${y}`;
    const p = by.get(key) ?? by.set(key, { a: flip ? y : x, b: flip ? x : y, weight: 0, types: {}, ab: 0, ba: 0 }).get(key)!;
    p.weight += n; p.types[type] = (p.types[type] ?? 0) + n;
    flip ? (p.ba += n) : (p.ab += n);
  };
  for (const [s, t, type, n] of g.edges) {
    if (!types.has(type)) continue;
    const a = g.nodes[s], b = g.nodes[t];
    if (CODE_EDGES.has(type) && (open.has(a) || open.has(b))) continue;
    add(a, b, type, n);
  }
  const seen = new Set<string>();
  for (const m of open) {
    for (const t of detail.get(m)!.types) add(m, t, "CONTAINS", 1);
    for (const r of detail.get(m)!.rels) {
      if (!CODE_EDGES.has(r.type) || !types.has(r.type)) continue;
      const key = `${r.source}|${r.target}|${r.type}|${r.source_line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A type outside the shown set stands for its whole module (nodeFor falls back to the module).
      const a = nodeFor(r.source), b = nodeFor(r.target);
      if (a && b) add(a, b, r.type, 1);
    }
  }
  return { pairs: [...by.values()], typeParent };
}

function buildGraph(nodes: string[], pairs: Pair[], typeParent: Map<string, string>, pos: Map<string, { x: number; y: number }>, first: boolean): Graph {
  const g = new Graph({ type: "undirected" });
  const total = new Map<string, number>();
  for (const p of pairs) { total.set(p.a, (total.get(p.a) ?? 0) + p.weight); total.set(p.b, (total.get(p.b) ?? 0) + p.weight); }
  const place = (id: string, i: number) => {
    const known = pos.get(id);
    if (known) return known;
    const parent = pos.get(typeParent.get(id) ?? "");
    if (parent) { const ang = i * 2.399963; return { x: parent.x + 2 * Math.cos(ang), y: parent.y + 2 * Math.sin(ang) }; }
    const r = 10 + Math.sqrt(i) * 3, ang = i * 2.399963; // spiral start, so layouts are reproducible
    return { x: r * Math.cos(ang), y: r * Math.sin(ang) };
  };
  [...nodes, ...typeParent.keys()].forEach((id, i) => {
    const isType = typeParent.has(id), base = REPO_COLOR[repoOf(isType ? typeParent.get(id)! : id)] ?? "#7e92a4";
    g.addNode(id, { ...place(id, i), size: isType ? Math.min(9, 2.5 + Math.sqrt(total.get(id) ?? 0) * 0.35) : Math.min(22, 4 + Math.sqrt(total.get(id) ?? 0) * 0.5),
      label: labelOf(id), color: isType ? lighten(base) : base });
  });
  for (const p of pairs) {
    if (!g.hasNode(p.a) || !g.hasNode(p.b)) continue;
    g.addEdge(p.a, p.b, { size: Math.min(6, 0.6 + Math.log10(1 + p.weight)), w: 1 + Math.log10(1 + p.weight), color: p.types.CONTAINS ? "#d5dde6" : "#9fb3c8" });
  }
  forceAtlas2.assign(g, { iterations: first ? 1500 : 300, settings: { ...forceAtlas2.inferSettings(g), linLogMode: true, gravity: 0.6, scalingRatio: 8, edgeWeightInfluence: 1 }, getEdgeWeight: "w" });
  g.forEachNode((id, a) => pos.set(id, { x: a.x, y: a.y }));
  return g;
}

const chip = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300"}`;

export default function GraphPage() {
  const [data, setData] = useState<ModuleGraph | null>(null);
  const [error, setError] = useState("");
  const [types, setTypes] = useState<Set<string>>(new Set(TYPES));
  const [sel, setSel] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [detail, setDetail] = useState<Map<string, Detail>>(new Map());
  const [indexes, setIndexes] = useState<Record<string, ShardIndex>>({});
  const [loading, setLoading] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const camera = useRef<any>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const selRef = useRef("");
  selRef.current = sel;

  useEffect(() => { loadModuleGraph().then(setData).catch(e => setError(e.message)); }, []);

  const { pairs, typeParent } = useMemo(
    () => (data ? expandedPairs(data, types, expanded, detail, indexes) : { pairs: [] as Pair[], typeParent: new Map<string, string>() }),
    [data, types, expanded, detail, indexes]);
  const graph = useMemo(
    () => (data ? buildGraph(data.nodes, pairs, typeParent, positions.current, positions.current.size === 0) : null),
    [data, pairs, typeParent]);

  useEffect(() => {
    if (!graph || !box.current) return;
    const s = new Sigma(graph, box.current, {
      labelRenderedSizeThreshold: 7, defaultDrawNodeHover: drawHover, labelColor: { color: isDark() ? "#e2e8f0" : "#334155" }, renderEdgeLabels: false,
      nodeReducer: (n, d) => {
        const cur = selRef.current;
        if (!cur) return d;
        if (n === cur) return { ...d, highlighted: true, zIndex: 2 };
        return graph.hasNode(cur) && graph.hasEdge(cur, n) ? { ...d, zIndex: 1 } : { ...d, color: isDark() ? "#334155" : "#d5dde6", label: "", zIndex: 0 };
      },
      edgeReducer: (e, d) => {
        const cur = selRef.current;
        return !cur ? d : graph.hasExtremity(e, cur) ? { ...d, color: "#00549e", size: d.size + 1 } : { ...d, hidden: true };
      },
    });
    if (camera.current) s.getCamera().setState(camera.current); // keep the view when the graph changes
    s.on("clickNode", ({ node }) => setSel(node));
    s.on("clickStage", () => setSel(""));
    s.on("enterNode", () => { if (box.current) box.current.style.cursor = "pointer"; });
    s.on("leaveNode", () => { if (box.current) box.current.style.cursor = ""; });
    const theme = new MutationObserver(() => { s.setSetting("labelColor", { color: isDark() ? "#e2e8f0" : "#334155" }); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    sigma.current = s;
    return () => { camera.current = s.getCamera().getState(); theme.disconnect(); s.kill(); sigma.current = null; };
  }, [graph]);

  useEffect(() => { sigma.current?.refresh(); }, [sel]);
  useEffect(() => { if (sel && graph && !graph.hasNode(sel)) setSel(""); }, [graph, sel]);

  const expand = async (id: string) => {
    if (detail.has(id)) { setExpanded(e => (e.includes(id) ? e : [...e, id])); return; }
    setLoading(id);
    try {
      const repo = repoOf(id), path = pathOf(id);
      const [symbols, out, inc, ...ix] = await Promise.all([
        loadModuleSymbols(repo, path), loadModuleRelationships(repo, path), loadModuleIncoming(repo, path),
        ...[...new Set(data!.nodes.map(repoOf))].map(r => loadShardIndex(r).then(i => [r, i] as const)),
      ]);
      setIndexes(Object.fromEntries(ix));
      const rels = [...out, ...inc];
      const typeIds = new Set(symbols.filter(s => TYPE_KINDS.has(s.kind)).map(s => s.id));
      const degree = new Map<string, number>();
      for (const r of rels) if (CODE_EDGES.has(r.type)) for (const e of [r.source, r.target]) { const t = ownerType(e); if (typeIds.has(t)) degree.set(t, (degree.get(t) ?? 0) + 1); }
      const top = [...typeIds].filter(t => degree.has(t)).sort((a, b) => degree.get(b)! - degree.get(a)!).slice(0, TOP_TYPES);
      setDetail(d => new Map(d).set(id, { types: top, rels, total: typeIds.size }));
      setExpanded(e => (e.includes(id) ? e : [...e, id]));
    } catch (e: any) { setError(e.message); } finally { setLoading(""); }
  };
  const collapse = (id: string) => setExpanded(e => e.filter(m => m !== id));

  const zoom = (f: number) => {
    const cam = sigma.current?.getCamera();
    if (cam) cam.animate({ ratio: cam.ratio / f }, { duration: reduceMotion() ? 0 : 200 });
  };
  const resetView = () => sigma.current?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: reduceMotion() ? 0 : 200 });

  const neighbours = useMemo(() => {
    if (!sel) return [];
    return pairs.filter(p => p.a === sel || p.b === sel).map(p => {
      const other = p.a === sel ? p.b : p.a;
      return { other, out: p.a === sel ? p.ab : p.ba, inc: p.a === sel ? p.ba : p.ab, types: p.types, weight: p.weight };
    }).sort((x, y) => y.weight - x.weight);
  }, [pairs, sel]);

  if (error) return <ErrorBox message={error} />;
  if (!data || !graph) return <Loading />;
  const toggle = (t: string) => { const n = new Set(types); n.has(t) ? n.delete(t) : n.add(t); setTypes(n); };
  const isType = typeParent.has(sel);
  const kindLabel = isType ? (graph.hasNode(sel) ? "type" : "") : "";
  const modules = [...data.nodes].sort((a, b) => short(a).localeCompare(short(b)));

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-bold">Module graph</h1>
        <p className="text-sm text-slate-600">
          Modules as nodes, sized by how many edges they have and placed by a force layout, so tightly coupled modules sit together.
          Lines join modules with calls, imports, inheritance, API use or add-on dependencies between them. Click a module to see its neighbours, and expand it to see its types.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Edge types">
          {TYPES.map(t => <button key={t} aria-pressed={types.has(t)} className={chip(types.has(t))} onClick={() => toggle(t)}>{t}</button>)}
        </div>
        <label className="ml-auto">Module{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white max-w-[14rem]" value={sel} onChange={e => setSel(e.target.value)} aria-label="Select a module">
            <option value="">none</option>
            {modules.map(m => <option key={m} value={m}>{short(m)}</option>)}
          </select>
        </label>
        <button className={chip(false)} onClick={() => zoom(1.5)} aria-label="Zoom in">+</button>
        <button className={chip(false)} onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">−</button>
        <button className={chip(false)} onClick={resetView}>Reset view</button>
        {expanded.length > 0 && <button className={chip(false)} onClick={() => setExpanded([])}>Collapse all</button>}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-3 items-start">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div ref={box} className="h-[60vh] min-h-[360px] w-full" role="img"
            aria-label={`Graph of ${graph.order} nodes and ${graph.size} linked pairs. The table beside it lists a selected node's neighbours.`} />
          <div className="flex flex-wrap gap-3 px-3 py-1.5 text-xs text-slate-600 border-t border-slate-100">
            {Object.entries(REPO_COLOR).filter(([r]) => data.nodes.some(n => repoOf(n) === r)).map(([r, c]) =>
              <span key={r}><span className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle" style={{ background: c }} />{r}</span>)}
            <span>{graph.order - typeParent.size} modules{typeParent.size > 0 && <> + {typeParent.size} types</>} · {graph.size} linked pairs</span>
          </div>
        </div>
        <aside aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-3 text-sm lg:max-h-[calc(60vh+2.5rem)] overflow-y-auto">
          {!sel ? <p className="text-slate-500 italic">Select a module in the graph or the list to see what it is linked to. Expand a module to see its most connected types.</p> : (<>
            <h2 className="font-semibold break-all">{labelOf(sel)}</h2>
            {isType ? (
              <div className="text-xs text-slate-500 mb-2">
                {kindLabel} in <button className="text-indigo-600 hover:underline" onClick={() => setSel(typeParent.get(sel)!)}>{short(typeParent.get(sel)!)}</button> ·{" "}
                <Link className="text-indigo-600 hover:underline" to={`/symbol/${encodeURIComponent(sel)}`}>open symbol</Link>
              </div>
            ) : (
              <div className="text-xs text-slate-500 mb-2 space-y-1">
                <div>{repoOf(sel)} · {neighbours.length} linked ·{" "}
                  <Link className="text-indigo-600 hover:underline" to={`/source?repo=${repoOf(sel)}&mod=${encodeURIComponent(pathOf(sel))}&tab=symbols`}>open in Source</Link></div>
                {expanded.includes(sel)
                  ? <div><button className={chip(false)} onClick={() => collapse(sel)}>Collapse types</button>{" "}
                      showing {detail.get(sel)!.types.length} of {detail.get(sel)!.total} types (the most connected)</div>
                  : <button className={chip(false)} disabled={!!loading} onClick={() => expand(sel)}>{loading === sel ? "Loading…" : "Expand into types"}</button>}
              </div>
            )}
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="pb-1">Linked to</th><th className="pb-1 text-right">Out</th><th className="pb-1 text-right pl-2">In</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {neighbours.map(n => (
                  <tr key={n.other} title={Object.entries(n.types).map(([t, c]) => `${t} ${c}`).join(", ")}>
                    <td className="py-0.5 break-all"><button className="text-indigo-600 hover:underline text-left" onClick={() => setSel(n.other)}>{labelOf(n.other)}</button>
                      {typeParent.has(n.other) && <span className="text-slate-400"> · {short(typeParent.get(n.other)!)}</span>}</td>
                    <td className="py-0.5 text-right tabular-nums">{n.out.toLocaleString()}</td>
                    <td className="py-0.5 text-right tabular-nums pl-2">{n.inc.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>)}
        </aside>
      </div>
      <p className="text-xs text-slate-400">Edge counts are resolved, inferred and syntactic edges together. Hover a row for its edge types. Expanded modules show their {TOP_TYPES} most connected types; the rest stay inside the module node.</p>
    </div>
  );
}
