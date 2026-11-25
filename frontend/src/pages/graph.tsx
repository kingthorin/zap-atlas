import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import { EdgeArrowProgram } from "sigma/rendering";
import {
  FileActivity, LanguageRow, ModuleActivity, ModuleGraph, Relationship, ShardIndex, loadFileActivity, loadLanguages, loadModuleActivity, loadModuleGraph, loadModuleIncoming, loadModuleRelationships, loadModuleSymbols, loadShardIndex,
} from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";
import { filePathOf } from "../lib/data";
import Sweep from "../components/sweep";

const REPO_COLOR: Record<string, string> = { zaproxy: "#4389ff", "zap-extensions": "#e08e00", "zap-core-help": "#2f9e6f", "zap-hud": "#8e5bd0" };
const EVIDENCE = ["resolved", "inferred", "syntactic"];
const TYPES = ["CALLS", "IMPORTS", "EXTENDS", "IMPLEMENTS", "USES_API", "DEPENDS_ON", "REFERENCES"];
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

/** Node labels with an outline in the page colour, so light text stays readable where it crosses the light grey edges. */
function drawLabel(ctx: CanvasRenderingContext2D, data: any, settings: any) {
  if (!data.label) return;
  const size = settings.labelSize, x = data.x + data.size + 3, y = data.y + size / 3;
  ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  ctx.lineJoin = "round"; ctx.lineWidth = 4;
  ctx.strokeStyle = isDark() ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.85)";
  ctx.strokeText(data.label, x, y);
  ctx.fillStyle = isDark() ? "#e2e8f0" : "#334155";
  ctx.fillText(data.label, x, y);
}

type SizeBy = "edges" | "commits" | "lines" | "dependents";
type View = "all" | "deps";
type ColourBy = "repo" | "recency" | "language";
const LANG_COLOR: Record<string, string> = {
  Java: "#4a7fb5", JavaScript: "#c9a400", HTML: "#e0603a", XML: "#8b5cf6", Properties: "#7e92a4", Markdown: "#475569",
  Gradle: "#2f9e6f", YAML: "#d9468f", JSON: "#0ea5a5", CSS: "#a855f7", Text: "#94a3b8",
};
const LANG_OTHER = "#b6c2cf";
const LANG_SHARE = 0.2;      // the language filter keeps modules where the language is at least this share of their lines
const yearOf = (day: string) => +day.slice(0, 4);
/** Old to new: slate to ZAP orange, both readable on the light and dark canvases. */
function ramp(t: number): string {
  const a = [0x6b, 0x7f, 0x94], b = [0xff, 0xa4, 0x00];
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, "0")).join("");
}

const repoOf = (id: string) => id.split(":")[1];
const pathOf = (id: string) => id.split(":").slice(2).join(":");
const short = (id: string) => (repoOf(id) === "zaproxy" ? `${pathOf(id)} (core)` : pathOf(id) === "src" ? repoOf(id).replace(/^zap-/, "") : pathOf(id).replace(/^addOns\//, "")); // zap-hud's one module is its src directory

const TYPE_KINDS = new Set(["class", "interface", "enum", "record", "annotation_type"]);
const CODE_EDGES = new Set(["CALLS", "IMPORTS", "EXTENDS", "IMPLEMENTS"]); // edges that expanding a module replaces with type-level ones
const DOC_PREFIX = /^doc:[^:]+:/;   // doc:<repo>:<path>; help pages link to each other with REFERENCES edges
const TOP_TYPES = 40; // most connected types shown per expanded module

type Mode = "types" | "files";
const TOP_FILES = 40, TOP_DOCS = 20; // most connected source files and help pages shown per module expanded into files
interface Detail { types: string[]; rels: Relationship[]; total: number; files: string[]; totalFiles: number; fileOf: Map<string, string> }
const ownerType = (id: string) => id.split("#")[0];
const fnode = (m: string, path: string) => `fnode:${repoOf(m)}:${path}`;
const dnode = (m: string, path: string) => `dnode:${repoOf(m)}:${path}`;
const isFileNode = (id: string) => id.startsWith("fnode:");
const isDirNode = (id: string) => id.startsWith("dnode:");
const labelOf = (id: string) =>
  id.startsWith("module:") ? short(id)
  : isFileNode(id) ? pathOf(id).split("/").pop()!
  : isDirNode(id) ? pathOf(id).split("/").slice(-2).join("/")
  : ownerType(id).split(":").slice(2).join(":").split(".").pop()!;
const lighten = (hex: string) => hex + "99";

interface DirTrie { path: string; dirs: Map<string, DirTrie>; files: string[] }

/** Structural edges for a module expanded into files: module -> directories -> files, single-child directory chains squashed. */
function fileTree(module: string, files: string[]): [string, string][] {
  const root: DirTrie = { path: pathOf(module), dirs: new Map(), files: [] };
  for (const f of files) {
    let node = root;
    for (const seg of f.slice(root.path.length + 1).split("/").slice(0, -1)) {
      const path = `${node.path}/${seg}`;
      node = node.dirs.get(seg) ?? node.dirs.set(seg, { path, dirs: new Map(), files: [] }).get(seg)!;
    }
    node.files.push(f);
  }
  const edges: [string, string][] = [];
  const emit = (node: DirTrie, parent: string) => {
    for (let child of node.dirs.values()) {
      while (child.dirs.size === 1 && child.files.length === 0) child = [...child.dirs.values()][0];
      edges.push([parent, dnode(module, child.path)]);
      emit(child, dnode(module, child.path));
    }
    for (const f of node.files) edges.push([parent, fnode(module, f)]);
  };
  emit(root, module);
  return edges;
}

interface Pair { a: string; b: string; weight: number; types: Record<string, number>; ab: number; ba: number }

type Kind = "type" | "file" | "dir";

/**
 * Pairs for the graph with some modules expanded, into their most connected types or files: their module-level
 * code edges are replaced by edges between those and the types, files or modules on the other side. A type or
 * file outside the shown set stands for its whole module.
 */
function expandedPairs(g: ModuleGraph, types: Set<string>, evidence: Set<string>, expanded: string[], modes: Record<string, Mode>,
                       detail: Map<string, Detail>, indexes: Record<string, ShardIndex>): { pairs: Pair[]; childParent: Map<string, string>; kinds: Map<string, Kind> } {
  const open = new Set(expanded.filter(m => detail.has(m)));
  const childParent = new Map<string, string>(), kinds = new Map<string, Kind>(), shownFiles = new Set<string>();
  const structure: [string, string][] = [];
  for (const m of open) {
    const d = detail.get(m)!;
    if (modes[m] === "files") {
      for (const f of d.files) { childParent.set(fnode(m, f), m); kinds.set(fnode(m, f), "file"); shownFiles.add(fnode(m, f)); }
      for (const [from, to] of fileTree(m, d.files)) {
        structure.push([from, to]);
        if (isDirNode(to)) { childParent.set(to, m); kinds.set(to, "dir"); }
      }
    } else {
      for (const t of d.types) { childParent.set(t, m); kinds.set(t, "type"); structure.push([m, t]); }
    }
  }
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
  const nodeFor = (symbol: string): string | null => {
    const t = ownerType(symbol);
    if (DOC_PREFIX.test(t)) {                    // a help page: its file node if shown, else the module that holds it
      const repo = t.split(":")[1], p = t.replace(DOC_PREFIX, "");
      const mod = (modulesOf.get(repo) ?? []).filter(m => p.startsWith(m + "/")).sort((a, b) => b.length - a.length)[0];
      const id = mod ? `module:${repo}:${mod}` : null;
      return id && open.has(id) && modes[id] === "files" && shownFiles.has(fnode(id, p)) ? fnode(id, p) : id;
    }
    if (childParent.has(t)) return t;
    const m = moduleOf(symbol);
    if (m && open.has(m) && modes[m] === "files") {
      const path = detail.get(m)!.fileOf.get(t);
      if (path && shownFiles.has(fnode(m, path))) return fnode(m, path);
    }
    return m;
  };

  const by = new Map<string, Pair>();
  const add = (x: string, y: string, type: string, n: number) => {
    if (x === y) return;
    const flip = x > y, key = flip ? `${y}|${x}` : `${x}|${y}`;
    const p = by.get(key) ?? by.set(key, { a: flip ? y : x, b: flip ? x : y, weight: 0, types: {}, ab: 0, ba: 0 }).get(key)!;
    p.weight += n; p.types[type] = (p.types[type] ?? 0) + n;
    flip ? (p.ba += n) : (p.ab += n);
  };
  for (const [s, t, type, n, ev] of g.edges) {
    if (!types.has(type) || !evidence.has(ev)) continue;
    const a = g.nodes[s], b = g.nodes[t];
    if (CODE_EDGES.has(type) && (open.has(a) || open.has(b))) continue;
    add(a, b, type, n);
  }
  for (const [from, to] of structure) add(from, to, "CONTAINS", 1);
  const seen = new Set<string>();
  for (const m of open) {
    for (const r of detail.get(m)!.rels) {
      if (!(CODE_EDGES.has(r.type) || r.type === "REFERENCES") || !types.has(r.type) || !evidence.has(r.evidence_type)) continue;
      const key = `${r.source}|${r.target}|${r.type}|${r.source_line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = nodeFor(r.source), b = nodeFor(r.target);
      if (a && b && (r.type !== "REFERENCES" || isFileNode(a) || isFileNode(b))) add(a, b, r.type, 1);   // page links show only between shown pages
    }
  }
  return { pairs: [...by.values()], childParent, kinds };
}

function buildGraph(nodes: string[], pairs: Pair[], typeParent: Map<string, string>, kinds: Map<string, Kind>, pos: Map<string, { x: number; y: number }>, first: boolean, hideIsolated = false): Graph {
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
  [...nodes, ...typeParent.keys()].filter(id => !hideIsolated || total.has(id)).forEach((id, i) => {
    const isChild = typeParent.has(id), base = REPO_COLOR[repoOf(isChild ? typeParent.get(id)! : id)] ?? "#7e92a4";
    const isDir = kinds.get(id) === "dir";
    g.addNode(id, { ...place(id, i), size: isDir ? 3.5 : isChild ? Math.min(9, 2.5 + Math.sqrt(total.get(id) ?? 0) * 0.35) : Math.min(22, 4 + Math.sqrt(total.get(id) ?? 0) * 0.5),
      label: labelOf(id), color: isDir ? "#94a3b8" : isChild ? lighten(base) : base });
  });
  for (const p of pairs) {
    if (!g.hasNode(p.a) || !g.hasNode(p.b)) continue;
    // A pair joined only by add-on dependencies in one direction is drawn as an arrow from the dependent to its dependency.
    const oneWayDeps = Object.keys(p.types).length === 1 && p.types.DEPENDS_ON && (p.ab === 0) !== (p.ba === 0);
    const [from, to] = oneWayDeps && p.ba > 0 ? [p.b, p.a] : [p.a, p.b];
    g.addEdge(from, to, { size: Math.min(6, 0.6 + Math.log10(1 + p.weight)), w: 1 + Math.log10(1 + p.weight), color: p.types.CONTAINS ? "#d5dde6" : "#9fb3c8",
      ...(oneWayDeps ? { type: "arrow" } : {}) });
  }
  forceAtlas2.assign(g, { iterations: first ? 1500 : 300, settings: { ...forceAtlas2.inferSettings(g), linLogMode: true, gravity: 0.6, scalingRatio: 8, edgeWeightInfluence: 1 }, getEdgeWeight: "w" });
  g.forEachNode((id, a) => pos.set(id, { x: a.x, y: a.y }));
  return g;
}

const chip = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300"}`;

interface TreeProps {
  modules: string[]; expanded: string[]; modes: Record<string, Mode>; detail: Map<string, Detail>;
  sel: string; faded: (id: string) => boolean; onSelect: (id: string) => void; onToggle: (id: string) => void; loading: string;
}

/** The modules, and the files, directories or types of expanded ones, as a nested list that mirrors the graph and works by keyboard. */
function TreePanel({ modules, expanded, modes, detail, sel, faded, onSelect, onToggle, loading }: TreeProps) {
  const [filter, setFilter] = useState("");
  const term = filter.trim().toLowerCase();
  const byRepo = new Map<string, string[]>();
  for (const m of modules) if (!term || short(m).toLowerCase().includes(term) || m === sel || expanded.includes(m)) (byRepo.get(repoOf(m)) ?? byRepo.set(repoOf(m), []).get(repoOf(m))!).push(m);
  const row = (id: string, depth: number, extra?: React.ReactNode) => (
    <li key={id}>
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
        {extra}
        <button className={`truncate text-left py-0.5 ${id === sel ? "font-semibold text-indigo-700" : faded(id) ? "text-slate-400" : "text-slate-700 hover:underline"}`}
          title={id.startsWith("module:") ? short(id) : pathOf(id)} aria-current={id === sel ? "true" : undefined} onClick={() => onSelect(id)}>{labelOf(id)}</button>
      </div>
    </li>
  );
  const children = (m: string): React.ReactNode => {
    const d = detail.get(m);
    if (!d || !expanded.includes(m)) return null;
    if (modes[m] !== "files") return <ul>{d.types.map(t => row(t, 2))}</ul>;
    const kids = new Map<string, string[]>();
    for (const [from, to] of fileTree(m, d.files)) (kids.get(from) ?? kids.set(from, []).get(from)!).push(to);
    const walk = (parent: string, depth: number): React.ReactNode[] => (kids.get(parent) ?? []).flatMap(c => [row(c, depth), ...walk(c, depth + 1)]);
    return <ul>{walk(m, 2)}</ul>;
  };
  return (
    <nav aria-label="Modules, files and types" className="rounded-xl border border-slate-200 bg-white p-2 text-sm max-h-48 xl:max-h-[calc(60vh+2.5rem)] overflow-y-auto">
      <input type="search" placeholder="Filter modules…" aria-label="Filter the tree" value={filter} onChange={e => setFilter(e.target.value)}
        className="w-full mb-2 rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
      {[...byRepo.entries()].map(([repo, mods]) => (
        <details key={repo} open={!!term || mods.some(m => expanded.includes(m) || m === sel) || mods.length <= 5}>
          <summary className="cursor-pointer font-semibold py-0.5">{repo} <span className="font-normal text-slate-400">({mods.length})</span></summary>
          <ul className="ml-1">
            {mods.map(m => (
              <li key={m}>
                <div className="flex items-center gap-1">
                  <button className="w-4 text-slate-500" aria-label={`${expanded.includes(m) ? "Collapse" : "Expand into files:"} ${short(m)}`} aria-expanded={expanded.includes(m)}
                    disabled={!!loading} onClick={() => onToggle(m)}>{loading === m ? "…" : expanded.includes(m) ? "▾" : "▸"}</button>
                  <button className={`truncate text-left py-0.5 ${m === sel ? "font-semibold text-indigo-700" : faded(m) ? "text-slate-400" : "text-slate-700 hover:underline"}`}
                    title={short(m)} aria-current={m === sel ? "true" : undefined} onClick={() => onSelect(m)}>{short(m)}</button>
                </div>
                {children(m)}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
}

export default function GraphPage() {
  const [data, setData] = useState<ModuleGraph | null>(null);
  const [error, setError] = useState("");
  const [types, setTypes] = useState<Set<string>>(new Set(useSearchParams()[0].get("view") === "deps" ? ["DEPENDS_ON"] : TYPES));
  const [sel, setSel] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [langRows, setLangRows] = useState<LanguageRow[]>([]);
  const [lang, setLang] = useState("");                         // "": any language
  const [hiddenRepos, setHiddenRepos] = useState<Set<string>>(new Set());
  const [find, setFind] = useState("");
  const [fileActivity, setFileActivity] = useState<FileActivity>({});
  const [detail, setDetail] = useState<Map<string, Detail>>(new Map());
  const [indexes, setIndexes] = useState<Record<string, ShardIndex>>({});
  const [loading, setLoading] = useState("");
  const [evidence, setEvidence] = useState<Set<string>>(new Set(EVIDENCE));
  const [params] = useSearchParams();
  const [view, setView] = useState<View>(params.get("view") === "deps" ? "deps" : "all");
  const [sizeBy, setSizeBy] = useState<SizeBy>(params.get("view") === "deps" ? "dependents" : "edges");
  const [colourBy, setColourBy] = useState<ColourBy>("repo");
  const [year, setYear] = useState<number | null>(null);       // null: every year
  const [activity, setActivity] = useState<Record<string, ModuleActivity>>({});
  const box = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);   // wraps the canvas; the sweep overlay is drawn in it
  const [side, setSide] = useState<HTMLDivElement | null>(null);   // beside it: the sweep's contributor names go here when there is room
  /** Extent of the drawn nodes in viewport pixels: centre and half-width, half-height. */
  const nodeBounds = useCallback(() => {
    const s = sigma.current, g = s?.getGraph();
    if (!s || !g || !g.order) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    g.forEachNode((_, a) => { const p = s.graphToViewport({ x: a.x, y: a.y }); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: Math.max(20, (x1 - x0) / 2), ry: Math.max(20, (y1 - y0) / 2) };
  }, []);
  // A copy of Sigma's layers for the sweep's WebM recording. WebGL canvases are cleared once drawn to the screen, so the
  // copy is made straight after each render, and only while a recording is running.
  const snap = useRef<HTMLCanvasElement | null>(null);
  const copyLayers = (s: Sigma) => {
    const layers = s.getCanvases();
    const base = layers.nodes;
    if (!base) return;
    const c = snap.current ?? (snap.current = document.createElement("canvas"));
    if (c.width !== base.width || c.height !== base.height) { c.width = base.width; c.height = base.height; }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const k of ["edges", "nodes", "labels", "hovers"]) if (layers[k]) ctx.drawImage(layers[k], 0, 0, c.width, c.height);
  };
  const sweepSnapshot = useCallback(() => new Promise<HTMLCanvasElement | null>(resolve => {
    const s = sigma.current;
    if (!s) return resolve(null);
    const once = () => { s.off("afterRender", once); resolve(snap.current); };
    s.on("afterRender", once);                                  // runs after the handler that copies the layers
    s.refresh();
  }), []);
  const [sigmaKey, setSigmaKey] = useState(0);                 // bumped when a new Sigma is made, so listeners on its camera are set again
  const onView = useCallback((cb: () => void) => {
    const cam = sigma.current?.getCamera();
    cam?.on("updated", cb);
    return () => { cam?.off("updated", cb); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigmaKey]);
  /** Resize to the container, then zoom out just enough to leave a margin round the nodes for the sweep's contributors. */
  const fitSweep = useCallback(() => {
    const s = sigma.current;
    if (!s) return;
    s.resize();
    const b = nodeBounds(), { width, height } = s.getDimensions();
    const k = b ? Math.min((width / 2 - 80) / b.rx, (height / 2 - 50) / b.ry, 1) : 1;
    if (k < 1) s.getCamera().animate({ ratio: s.getCamera().ratio / k }, { duration: reduceMotion() ? 0 : 300 }); else s.refresh();
  }, [nodeBounds]);
  const sigma = useRef<Sigma | null>(null);
  const camera = useRef<any>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const selRef = useRef("");
  selRef.current = sel;
  const years = useMemo(() => {
    const all = Object.values(activity).flatMap(a => [yearOf(a.first), yearOf(a.last)]);
    return all.length ? { min: Math.min(...all), max: Math.max(...all) } : null;
  }, [activity]);
  /** module id -> how many modules declare a dependency on it (add-on dependencies, from the module graph). */
  const dependents = useMemo(() => {
    const by = new Map<string, number>();
    for (const [, t, type] of data?.edges ?? []) if (type === "DEPENDS_ON") by.set(data!.nodes[t], (by.get(data!.nodes[t]) ?? 0) + 1);
    return { by, max: Math.max(1, ...by.values()) };
  }, [data]);
  const maxOf = useMemo(() => ({
    commits: Math.max(1, ...Object.values(activity).map(a => a.commits)), lines: Math.max(1, ...Object.values(activity).map(a => a.lines)),
  }), [activity]);

  const maxFile = useMemo(() => {
    const all = Object.values(fileActivity).flatMap(r => Object.values(r));
    return { commits: Math.max(1, ...all.map(a => a[2])), lines: Math.max(1, ...all.map(a => a[3])) };
  }, [fileActivity]);

  /** module id -> language -> share of the module's lines; the dominant language of each module. */
  const langs = useMemo(() => {
    const lines = new Map<string, Map<string, number>>();
    for (const r of langRows) if (r.module) {
      const id = `module:${r.repository}:${r.module}`, m = lines.get(id) ?? lines.set(id, new Map()).get(id)!;
      m.set(r.language, (m.get(r.language) ?? 0) + r.lines);
    }
    const share = new Map<string, Map<string, number>>(), dominant = new Map<string, string>(), all = new Map<string, number>();
    for (const [id, m] of lines) {
      const total = [...m.values()].reduce((a, b) => a + b, 0) || 1;
      share.set(id, new Map([...m].map(([l, n]) => [l, n / total] as const)));
      dominant.set(id, [...m].sort((a, b) => b[1] - a[1])[0][0]);
      for (const [l, n] of m) all.set(l, (all.get(l) ?? 0) + n);
    }
    return { share, dominant, options: [...all].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([l]) => l) };
  }, [langRows]);

  useEffect(() => {
    loadModuleGraph().then(setData).catch(e => setError(e.message));
    loadModuleActivity().then(setActivity).catch(() => {});
    loadLanguages().then(setLangRows).catch(() => {});
  }, []);

  const { pairs, childParent: typeParent, kinds } = useMemo(
    () => (data ? expandedPairs(data, types, evidence, expanded, modes, detail, indexes)
      : { pairs: [] as Pair[], childParent: new Map<string, string>(), kinds: new Map<string, Kind>() }),
    [data, types, evidence, expanded, modes, detail, indexes]);
  const styleRef = useRef<any>({});
  styleRef.current = { dependents, sizeBy, colourBy, year, activity, years, maxOf, typeParent, kinds, fileActivity, maxFile, lang, langs, hiddenRepos };
  const graph = useMemo(
    () => (data ? buildGraph(data.nodes, pairs, typeParent, kinds, positions.current, positions.current.size === 0, view === "deps") : null),
    [data, pairs, typeParent, kinds, view]);

  /** Activity of a node: a file's own, or that of the module a type or directory belongs to. */
  const actOf = (n: string): ModuleActivity | null => {
    const st = styleRef.current;
    if (st.kinds.get(n) === "file") {
      const a = st.fileActivity[repoOf(n)]?.[pathOf(n)];
      if (a) return { first: a[0], last: a[1], commits: a[2], lines: a[3] };
    }
    return st.activity[st.typeParent.get(n) ?? n] ?? null;
  };
  /** Is a node filtered out: its repository hidden, its module short of the chosen language, or outside the chosen year? */
  const isFaded = (n: string): boolean => {
    const st = styleRef.current, owner = st.typeParent.get(n) ?? n;
    if (st.hiddenRepos.has(repoOf(owner))) return true;
    if (st.lang && owner.startsWith("module:") && (st.langs.share.get(owner)?.get(st.lang) ?? 0) < LANG_SHARE) return true;
    const act = actOf(n);
    return st.year != null && !!act && (yearOf(act.first) > st.year || yearOf(act.last) < st.year);
  };
  // For the sweep overlay: where a module is drawn now (null if it is not shown), kept stable so the animation is not restarted by renders.
  const sweepPosition = useCallback((id: string) => {
    const s = sigma.current, g = s?.getGraph();
    if (!s || !g || !g.hasNode(id) || !id.startsWith("module:") || styleRef.current.hiddenRepos.has(repoOf(id))) return null;
    const a = g.getNodeAttributes(id);
    return s.graphToViewport({ x: a.x, y: a.y });
  }, []);
  const sweepColor = useCallback((id: string) => REPO_COLOR[repoOf(id)] ?? "#7e92a4", []);
  /** Size by activity, colour by recency, and fade by year, applied on top of the graph's own attributes. */
  const styleNode = (n: string, d: any) => {
    const st = styleRef.current, kind = st.kinds.get(n), act = actOf(n);
    let out = d;
    if (st.sizeBy === "dependents" && !kind) out = { ...out, size: 3 + 19 * Math.sqrt((st.dependents.by.get(n) ?? 0) / st.dependents.max) };
    if (!act) return isFaded(n) ? { ...out, color: isDark() ? "#2a3548" : "#e6ecf2", label: "", zIndex: -1 } : out;
    const by = st.sizeBy as "commits" | "lines";
    const byActivity = st.sizeBy === "commits" || st.sizeBy === "lines";
    if (byActivity && !kind) out = { ...out, size: 3 + 19 * Math.sqrt(act[by] / st.maxOf[by]) };
    if (byActivity && kind === "file") out = { ...out, size: 2.5 + 7 * Math.sqrt(act[by] / st.maxFile[by]) };
    if (st.colourBy === "language" && (!kind || kind === "file")) {
      const dom = st.langs.dominant.get(st.typeParent.get(n) ?? n);
      out = { ...out, color: (dom && LANG_COLOR[dom] || LANG_OTHER) + (kind ? "dd" : "") };
    }
    if (st.colourBy === "recency" && st.years && (!kind || kind === "file"))
      out = { ...out, color: ramp((yearOf(act.last) - st.years.min) / Math.max(1, st.years.max - st.years.min)) + (kind ? "dd" : "") };
    if (isFaded(n)) out = { ...out, color: isDark() ? "#2a3548" : "#e6ecf2", label: "", zIndex: -1 };
    return out;
  };

  useEffect(() => {
    if (!graph || !box.current) return;
    const s = new Sigma(graph, box.current, {
      labelRenderedSizeThreshold: 7, defaultDrawNodeHover: drawHover, defaultDrawNodeLabel: drawLabel, labelColor: { color: isDark() ? "#e2e8f0" : "#334155" }, renderEdgeLabels: false, edgeProgramClasses: { arrow: EdgeArrowProgram },
      nodeReducer: (n, raw) => {
        const cur = selRef.current, d = styleNode(n, raw);
        if (!cur) return d;
        if (n === cur) return { ...d, highlighted: true, zIndex: 2 };
        return graph.hasNode(cur) && graph.hasEdge(cur, n) ? { ...d, zIndex: 1 } : { ...d, color: isDark() ? "#334155" : "#d5dde6", label: "", zIndex: 0 };
      },
      edgeReducer: (e, d) => {
        const cur = selRef.current;
        if (graph.extremities(e).some(n => isFaded(n))) return { ...d, hidden: true };
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
    s.on("afterRender", () => { if (document.documentElement.dataset.recording) copyLayers(s); });
    sigma.current = s; setSigmaKey(k => k + 1);
    // Sigma only notices a window resize. The container also changes size with the full-width toggle and the names column,
    // so watch it and let Sigma fit itself to the new size (the graph stays centred).
    const watch = new ResizeObserver(() => { s.resize(); s.refresh(); });
    watch.observe(box.current);
    return () => { camera.current = s.getCamera().getState(); watch.disconnect(); theme.disconnect(); s.kill(); sigma.current = null; };
  }, [graph]);

  useEffect(() => { sigma.current?.refresh(); }, [sel, sizeBy, colourBy, year, activity, fileActivity, lang, hiddenRepos, langs]);
  useEffect(() => { if (sel && graph && !graph.hasNode(sel)) setSel(""); }, [graph, sel]);

  const expand = async (id: string, mode: Mode = "types") => {
    const done = () => { setModes(m => ({ ...m, [id]: mode })); setExpanded(e => (e.includes(id) ? e : [...e, id])); };
    if (mode === "files" && !Object.keys(fileActivity).length) loadFileActivity().then(setFileActivity).catch(() => {});
    if (detail.has(id)) { done(); return; }
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
      const fileOf = new Map<string, string>(symbols.map(s => [s.id, filePathOf(s.file)] as const));
      const degree = new Map<string, number>(), fileDegree = new Map<string, number>();
      for (const r of rels) if (CODE_EDGES.has(r.type)) for (const e of [r.source, r.target]) {
        const t = ownerType(e), f = fileOf.get(t);
        if (typeIds.has(t)) degree.set(t, (degree.get(t) ?? 0) + 1);
        if (f) fileDegree.set(f, (fileDegree.get(f) ?? 0) + 1);
      }
      const inModule = (p: string) => p === path || p.startsWith(path + "/");
      const docDegree = new Map<string, number>();
      for (const r of rels) if (r.type === "REFERENCES") for (const e of [r.source, r.target]) {
        const p = DOC_PREFIX.test(e) ? e.replace(DOC_PREFIX, "") : "";
        if (p && inModule(p)) docDegree.set(p, (docDegree.get(p) ?? 0) + 1);
      }
      const docs = [...docDegree.keys()].sort((a, b) => docDegree.get(b)! - docDegree.get(a)!).slice(0, TOP_DOCS);
      const top = [...typeIds].filter(t => degree.has(t)).sort((a, b) => degree.get(b)! - degree.get(a)!).slice(0, TOP_TYPES);
      const files = [...[...fileDegree.keys()].sort((a, b) => fileDegree.get(b)! - fileDegree.get(a)!).slice(0, TOP_FILES), ...docs];
      setDetail(d => new Map(d).set(id, { types: top, rels, total: typeIds.size, files, totalFiles: new Set(fileOf.values()).size + docDegree.size, fileOf }));
      done();
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
  const isChild = typeParent.has(sel), kind = kinds.get(sel) ?? "";
  const kindLabel = kind === "file" ? "file" : kind === "dir" ? "directory" : "type";
  const counts = [["types", "type"], ["files", "file"], ["directories", "dir"]]
    .map(([label, k]) => [label, [...kinds.values()].filter(v => v === k).length] as const).filter(([, n]) => n > 0);
  const childOf = (n: string) => typeParent.get(n) ?? "";
  const sourceLink = (m: string, dir: string) => `/source?repo=${repoOf(m)}&mod=${encodeURIComponent(pathOf(m))}${dir ? `&dir=${encodeURIComponent(dir)}` : ""}&tab=symbols`;
  const modules = [...data.nodes].sort((a, b) => short(a).localeCompare(short(b)));
  const repoNames = [...new Set(data.nodes.map(repoOf))];
  const findMap = new Map<string, string>();
  graph.forEachNode(id => findMap.set(typeParent.has(id) ? `${labelOf(id)} (${short(typeParent.get(id)!)})` : labelOf(id), id));

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-bold">Module graph</h1>
        <p className="text-sm text-slate-600">
          Modules as nodes, sized by how many edges they have and placed by a force layout, so tightly coupled modules sit together.
          Lines join modules with calls, imports, inheritance, API use or add-on dependencies between them. "Add-on dependencies" keeps only those edges, as arrows from an add-on to what it depends on, and drops modules with none. Click a module to see its neighbours, and expand it to see its types.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex gap-1" role="group" aria-label="View">
          <button aria-pressed={view === "all"} className={chip(view === "all")}
            onClick={() => { setView("all"); setTypes(new Set(TYPES)); setSizeBy("edges"); }}>All links</button>
          <button aria-pressed={view === "deps"} className={chip(view === "deps")}
            onClick={() => { setView("deps"); setTypes(new Set(["DEPENDS_ON"])); setSizeBy("dependents"); }}>Add-on dependencies</button>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Edge types">
          {TYPES.map(t => <button key={t} aria-pressed={types.has(t)} className={chip(types.has(t))} onClick={() => toggle(t)}>{t}</button>)}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Evidence level">
          <span className="text-xs text-slate-500 self-center">Evidence:</span>
          {EVIDENCE.map(e => <button key={e} aria-pressed={evidence.has(e)} className={chip(evidence.has(e))}
            onClick={() => { const n = new Set(evidence); n.has(e) ? n.delete(e) : n.add(e); setEvidence(n); }}>{e}</button>)}
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label>Size by{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={sizeBy} onChange={e => setSizeBy(e.target.value as SizeBy)}>
            <option value="edges">links to other modules</option><option value="dependents">add-ons that depend on it</option><option value="commits">commits</option><option value="lines">lines changed</option>
          </select>
        </label>
        <label>Colour by{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={colourBy} onChange={e => setColourBy(e.target.value as ColourBy)}>
            <option value="repo">repository</option><option value="recency">last activity</option><option value="language">main language</option>
          </select>
        </label>
        {langs.options.length > 0 && (
          <label title={`Keeps modules where the language is at least ${LANG_SHARE * 100}% of their lines`}>Language{" "}
            <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={lang} onChange={e => setLang(e.target.value)}>
              <option value="">any</option>{langs.options.map(l => <option key={l}>{l}</option>)}
            </select>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Repositories">
          {repoNames.map(r => (
            <button key={r} aria-pressed={!hiddenRepos.has(r)} className={chip(!hiddenRepos.has(r))}
              onClick={() => { const n = new Set(hiddenRepos); n.has(r) ? n.delete(r) : n.add(r); setHiddenRepos(n); }}>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: REPO_COLOR[r] ?? "#7e92a4" }} aria-hidden="true" />{r}</button>
          ))}
        </div>
        <label>Find{" "}
          <input list="graph-find" value={find} placeholder="module, type or file" onChange={e => { setFind(e.target.value); const id = findMap.get(e.target.value); if (id) setSel(id); }}
            className="border border-slate-300 rounded px-2 py-1 bg-white w-44" />
          <datalist id="graph-find">{[...findMap.keys()].map(k => <option key={k} value={k} />)}</datalist>
        </label>
        {years && (
          <label className="flex items-center gap-2">Year
            <input type="range" min={years.min} max={years.max + 1} value={year ?? years.max + 1}
              onChange={e => setYear(+e.target.value > years.max ? null : +e.target.value)} aria-valuetext={year == null ? "Any year" : `Active in ${year}`} />
            <span className="w-28 text-slate-600">{year == null ? "any year" : `active in ${year}`}</span>
          </label>
        )}
        {colourBy === "language" && (
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-600" aria-label="Language colours">
            {[...new Set(data.nodes.map(n => langs.dominant.get(n)).filter(Boolean) as string[])].map(l => (
              <span key={l}><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: LANG_COLOR[l] ?? LANG_OTHER }} aria-hidden="true" />{l}</span>))}
          </span>
        )}
        {colourBy === "recency" && years && (
          <span className="flex items-center gap-1 text-xs text-slate-600">last commit {years.min}
            <span className="inline-block w-24 h-2 rounded" style={{ background: `linear-gradient(to right, ${ramp(0)}, ${ramp(1)})` }} aria-hidden="true" />{years.max}</span>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] xl:grid-cols-[15rem_minmax(0,1fr)_21rem] gap-3 items-start">
        <div className="lg:col-span-2 xl:col-span-1">
          <TreePanel modules={modules} expanded={expanded} modes={modes} detail={detail} sel={sel} loading={loading}
            faded={id => styleRef.current.hiddenRepos.has(repoOf(id)) || (!!lang && id.startsWith("module:") && (langs.share.get(id)?.get(lang) ?? 0) < LANG_SHARE)}
            onSelect={setSel} onToggle={id => (expanded.includes(id) ? collapse(id) : expand(id, "files"))} />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex">
            <div ref={setHost} className="relative flex-1 min-w-0">
              <div ref={box} className="h-[60vh] min-h-[360px] w-full" role="img"
                aria-label={`Graph of ${graph.order} nodes and ${graph.size} linked pairs. The table beside it lists a selected node's neighbours.`} />
            </div>
            <div ref={setSide} className="empty:hidden" />
          </div>
          <div className="flex flex-wrap gap-3 px-3 py-1.5 text-xs text-slate-600 border-t border-slate-100">
            {Object.entries(REPO_COLOR).filter(([r]) => data.nodes.some(n => repoOf(n) === r)).map(([r, c]) =>
              <span key={r}><span className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle" style={{ background: c }} />{r}</span>)}
            <span>{graph.order - typeParent.size} modules{counts.length > 0 && <> + {counts.map(([l, n]) => `${n} ${l}`).join(", ")}</>} · {graph.size} linked pairs</span>
          </div>
          {years && <Sweep host={host} side={side} fit={fitSweep} onView={onView} snapshot={sweepSnapshot} bounds={nodeBounds} minYear={years.min} maxYear={years.max} label={short} nodePosition={sweepPosition} colorOf={sweepColor} />}
        </div>
        <aside aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-3 text-sm lg:max-h-[calc(60vh+2.5rem)] overflow-y-auto">
          {!sel ? <p className="text-slate-500 italic">Select a module in the graph or the list to see what it is linked to. Expand a module to see its most connected types, or its files and directories.</p> : (<>
            <h2 className="font-semibold break-all">{labelOf(sel)}</h2>
            {isChild ? (
              <div className="text-xs text-slate-500 mb-2 space-y-1">
                <div>{kindLabel} in <button className="text-indigo-600 hover:underline" onClick={() => setSel(childOf(sel))}>{short(childOf(sel))}</button> ·{" "}
                  {kind === "type"
                    ? <Link className="text-indigo-600 hover:underline" to={`/symbol/${encodeURIComponent(sel)}`}>open symbol</Link>
                    : <Link className="text-indigo-600 hover:underline" to={sourceLink(childOf(sel), pathOf(sel))}>open in Source</Link>}</div>
                {kind !== "dir" && (() => { const a = actOf(sel); return a ? <div>{a.commits.toLocaleString()} commits · {a.lines.toLocaleString()} lines changed · first {a.first}, last {a.last}</div> : null; })()}
                {kind !== "type" && <div className="break-all font-mono">{pathOf(sel)}</div>}
              </div>
            ) : (
              <div className="text-xs text-slate-500 mb-2 space-y-1">
                <div>{repoOf(sel)} · {neighbours.length} linked ·{" "}
                  <Link className="text-indigo-600 hover:underline" to={sourceLink(sel, "")}>open in Source</Link></div>
                {activity[sel] && <div>{activity[sel].commits.toLocaleString()} commits · {activity[sel].lines.toLocaleString()} lines changed · first {activity[sel].first}, last {activity[sel].last}</div>}
                {expanded.includes(sel) && (
                  <div>showing {modes[sel] === "files" ? `${detail.get(sel)!.files.length} of ${detail.get(sel)!.totalFiles} files` : `${detail.get(sel)!.types.length} of ${detail.get(sel)!.total} types`} (the most connected)</div>)}
                <div className="flex flex-wrap gap-1">
                  {expanded.includes(sel) && <button className={chip(false)} onClick={() => collapse(sel)}>{modes[sel] === "files" ? "Collapse files" : "Collapse types"}</button>}
                  {(!expanded.includes(sel) || modes[sel] === "files") && <button className={chip(false)} disabled={!!loading} onClick={() => expand(sel, "types")}>{loading === sel ? "Loading…" : "Expand into types"}</button>}
                  {(!expanded.includes(sel) || modes[sel] !== "files") && <button className={chip(false)} disabled={!!loading} onClick={() => expand(sel, "files")}>{loading === sel ? "Loading…" : "Expand into files"}</button>}
                </div>
              </div>
            )}
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="pb-1">Linked to</th><th className="pb-1 text-right">Out</th><th className="pb-1 text-right pl-2">In</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {neighbours.map(n => (
                  <tr key={n.other} title={Object.entries(n.types).map(([t, c]) => `${t} ${c}`).join(", ")}>
                    <td className="py-0.5 break-all"><button className="text-indigo-600 hover:underline text-left" onClick={() => setSel(n.other)}>{labelOf(n.other)}</button>
                      {typeParent.has(n.other) && <span className="text-slate-400"> · {short(childOf(n.other))}</span>}</td>
                    <td className="py-0.5 text-right tabular-nums">{n.out.toLocaleString()}</td>
                    <td className="py-0.5 text-right tabular-nums pl-2">{n.inc.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>)}
        </aside>
      </div>
      <p className="text-xs text-slate-400">Edge counts are resolved, inferred and syntactic edges together. Hover a row for its edge types. Expanded modules show their {TOP_TYPES} most connected types; the rest stay inside the module node. Year fades modules whose first commit is later, or last commit earlier, than the chosen year Activity counts file changes under the module\'s current path only, so history from before a module moved there (most zap-extensions add-ons were reorganised in 2019) is not included, and a module with no commits in between still counts as active.</p>
    </div>
  );
}
