import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import { ModuleGraph, loadModuleGraph } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

const REPO_COLOR: Record<string, string> = { zaproxy: "#4389ff", "zap-extensions": "#e08e00", "zap-core-help": "#2f9e6f" };
const TYPES = ["CALLS", "IMPORTS", "EXTENDS", "IMPLEMENTS", "USES_API", "DEPENDS_ON"];
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isDark = () => document.documentElement.classList.contains("dark");

const repoOf = (id: string) => id.split(":")[1];
const pathOf = (id: string) => id.split(":").slice(2).join(":");
const short = (id: string) => (repoOf(id) === "zaproxy" ? `${pathOf(id)} (core)` : pathOf(id).replace(/^addOns\//, ""));

interface Pair { a: string; b: string; weight: number; types: Record<string, number>; ab: number; ba: number }

/** Edges between modules for the enabled edge types; one pair per module couple, with direction counts. */
function pairsFor(g: ModuleGraph, types: Set<string>): Pair[] {
  const by = new Map<string, Pair>();
  for (const [s, t, type, n] of g.edges) {
    if (!types.has(type)) continue;
    const a = g.nodes[s], b = g.nodes[t], flip = a > b;
    const key = flip ? `${b}|${a}` : `${a}|${b}`;
    const p = by.get(key) ?? by.set(key, { a: flip ? b : a, b: flip ? a : b, weight: 0, types: {}, ab: 0, ba: 0 }).get(key)!;
    p.weight += n; p.types[type] = (p.types[type] ?? 0) + n;
    flip ? (p.ba += n) : (p.ab += n);
  }
  return [...by.values()];
}

function buildGraph(nodes: string[], pairs: Pair[]): Graph {
  const g = new Graph({ type: "undirected" });
  const total = new Map<string, number>();
  for (const p of pairs) { total.set(p.a, (total.get(p.a) ?? 0) + p.weight); total.set(p.b, (total.get(p.b) ?? 0) + p.weight); }
  nodes.forEach((id, i) => {
    const r = 10 + Math.sqrt(i) * 3, ang = i * 2.399963; // spiral start, so layouts are reproducible
    g.addNode(id, { x: r * Math.cos(ang), y: r * Math.sin(ang), size: Math.min(22, 4 + Math.sqrt(total.get(id) ?? 0) * 0.5), label: short(id), color: REPO_COLOR[repoOf(id)] ?? "#7e92a4" });
  });
  for (const p of pairs) g.addEdge(p.a, p.b, { size: Math.min(6, 0.6 + Math.log10(1 + p.weight)), w: 1 + Math.log10(1 + p.weight), color: "#9fb3c8" });
  forceAtlas2.assign(g, { iterations: 1500, settings: { ...forceAtlas2.inferSettings(g), linLogMode: true, gravity: 0.6, scalingRatio: 8, edgeWeightInfluence: 1 }, getEdgeWeight: "w" });
  return g;
}

const chip = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300"}`;

export default function GraphPage() {
  const [data, setData] = useState<ModuleGraph | null>(null);
  const [error, setError] = useState("");
  const [types, setTypes] = useState<Set<string>>(new Set(TYPES));
  const [sel, setSel] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const selRef = useRef("");
  selRef.current = sel;

  useEffect(() => { loadModuleGraph().then(setData).catch(e => setError(e.message)); }, []);

  const pairs = useMemo(() => (data ? pairsFor(data, types) : []), [data, types]);
  const graph = useMemo(() => (data ? buildGraph(data.nodes, pairs) : null), [data, pairs]);

  useEffect(() => {
    if (!graph || !box.current) return;
    const s = new Sigma(graph, box.current, {
      labelRenderedSizeThreshold: 7, labelColor: { color: isDark() ? "#e2e8f0" : "#334155" }, renderEdgeLabels: false,
      nodeReducer: (n, d) => {
        const cur = selRef.current;
        if (!cur) return d;
        if (n === cur) return { ...d, highlighted: true, zIndex: 2 };
        return graph.hasEdge(cur, n) ? { ...d, zIndex: 1 } : { ...d, color: "#d5dde6", label: "", zIndex: 0 };
      },
      edgeReducer: (e, d) => {
        const cur = selRef.current;
        return !cur ? d : graph.hasExtremity(e, cur) ? { ...d, color: "#00549e", size: d.size + 1 } : { ...d, hidden: true };
      },
    });
    s.on("clickNode", ({ node }) => setSel(node));
    s.on("clickStage", () => setSel(""));
    s.on("enterNode", () => { if (box.current) box.current.style.cursor = "pointer"; });
    s.on("leaveNode", () => { if (box.current) box.current.style.cursor = ""; });
    const theme = new MutationObserver(() => { s.setSetting("labelColor", { color: isDark() ? "#e2e8f0" : "#334155" }); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    sigma.current = s;
    return () => { theme.disconnect(); s.kill(); sigma.current = null; };
  }, [graph]);

  useEffect(() => { sigma.current?.refresh(); }, [sel]);
  useEffect(() => { if (sel && graph && !graph.hasNode(sel)) setSel(""); }, [graph, sel]);

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
  const modules = [...data.nodes].sort((a, b) => short(a).localeCompare(short(b)));

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-bold">Module graph</h1>
        <p className="text-sm text-slate-600">
          Modules as nodes, sized by how many edges they have and placed by a force layout, so tightly coupled modules sit together.
          Lines join modules with calls, imports, inheritance, API use or add-on dependencies between them. Click a module to see its neighbours.
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
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-3 items-start">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div ref={box} className="h-[60vh] min-h-[360px] w-full" role="img"
            aria-label={`Graph of ${graph.order} modules and ${graph.size} module pairs. The table beside it lists a selected module's neighbours.`} />
          <div className="flex flex-wrap gap-3 px-3 py-1.5 text-xs text-slate-600 border-t border-slate-100">
            {Object.entries(REPO_COLOR).filter(([r]) => data.nodes.some(n => repoOf(n) === r)).map(([r, c]) =>
              <span key={r}><span className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle" style={{ background: c }} />{r}</span>)}
            <span>{graph.order} modules · {graph.size} linked pairs</span>
          </div>
        </div>
        <aside aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-3 text-sm lg:max-h-[calc(60vh+2.5rem)] overflow-y-auto">
          {!sel ? <p className="text-slate-500 italic">Select a module in the graph or the list to see what it is linked to.</p> : (<>
            <h2 className="font-semibold break-all">{short(sel)}</h2>
            <div className="text-xs text-slate-500 mb-2">
              {repoOf(sel)} · {neighbours.length} linked modules ·{" "}
              <Link className="text-indigo-600 hover:underline" to={`/source?repo=${repoOf(sel)}&mod=${encodeURIComponent(pathOf(sel))}&tab=symbols`}>open in Source</Link>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="pb-1">Module</th><th className="pb-1 text-right">Out</th><th className="pb-1 text-right pl-2">In</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {neighbours.map(n => (
                  <tr key={n.other} title={Object.entries(n.types).map(([t, c]) => `${t} ${c}`).join(", ")}>
                    <td className="py-0.5 break-all"><button className="text-indigo-600 hover:underline text-left" onClick={() => setSel(n.other)}>{short(n.other)}</button></td>
                    <td className="py-0.5 text-right tabular-nums">{n.out.toLocaleString()}</td>
                    <td className="py-0.5 text-right tabular-nums pl-2">{n.inc.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>)}
        </aside>
      </div>
      <p className="text-xs text-slate-400">Edge counts are resolved, inferred and syntactic edges together. Hover a row for its edge types. Expanding a module into its files and types is not built yet.</p>
    </div>
  );
}
