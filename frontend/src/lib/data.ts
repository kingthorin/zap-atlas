/** Lightweight static-data loader for the Atlas dataset.

Loads chunked JSONL on demand and exposes typed accessors. Designed so the app
shell never downloads the whole dataset at startup.
*/

export interface Repo { id: string; name: string; url: string; default_branch: string; sha: string; description?: string }
export interface Commit { id: string; repository: string; sha: string; parents: string[]; author_name: string; author_date: string; committer_date: string; subject: string; message: string; branches: string[]; tags: string[]; additions?: number; deletions?: number }
export interface Module { id: string; repository: string; name: string; path: string; kind: string; addon: boolean }
export interface AddOn { id: string; module: string; name: string; status: string; author: string; url: string; dependencies: string[] }
export interface Symbol { id: string; repository: string; file: string; qualified_name: string; kind: string; signature: string; start_line: number; end_line: number; resolution: string; annotations?: string[] }
export interface Relationship { source: string; target: string; type: string; repository: string; evidence_type: string; source_file?: string; source_line?: number }
export interface Doc { id: string; repository: string; module?: string; commit_count?: number; last_changed?: string | null; commits?: string[]; path: string; title: string; headings: string[]; anchors: string[] }
export interface Story { id: string; status?: string; group?: string; date?: string; title: string; description: string; chapters: any[]; entities: string[]; commits: string[]; documents: string[] }
export interface Manifest { schema_version: string; generator_version: string; generated_at: string; sources: any[]; inventory: any[]; coverage: any; chunks: string[] }

const DATA_DIR = import.meta.env.DEV ? "/data" : (import.meta.env.BASE_URL || "/") + "data";

let manifestCache: Manifest | null = null;
const jsonlCache = new Map<string, any[]>();

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  const text = await res.text();
  // Static hosts and the dev server answer unknown paths with index.html; report that clearly.
  if (res.headers.get("content-type")?.includes("text/html") && !url.endsWith(".html")) {
    throw new Error(`data file missing: ${url}`);
  }
  return text;
}

async function parseJsonl(text: string): Promise<any[]> {
  return text.split("\n").map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
}

export async function loadManifest(): Promise<Manifest> {
  if (manifestCache) return manifestCache;
  const text = await fetchText(`${DATA_DIR}/manifest.json`);
  manifestCache = JSON.parse(text);
  return manifestCache!;
}

export async function loadChunk(name: string): Promise<any[]> {
  if (jsonlCache.has(name)) return jsonlCache.get(name)!;
  const text = await fetchText(`${DATA_DIR}/${name}`);
  const rows = await parseJsonl(text);
  jsonlCache.set(name, rows);
  return rows;
}

export async function loadRepos(): Promise<Repo[]> {
  const rows = await loadChunk("repos.jsonl");
  return rows as Repo[];
}
/** repo -> year -> row counts per kind; small, tells the UI which shards exist. */
export type HistoryIndex = Record<string, Record<string, { commits?: number; files?: number }>>;

let historyIndexCache: HistoryIndex | null = null;
export async function loadHistoryIndex(): Promise<HistoryIndex> {
  if (historyIndexCache) return historyIndexCache;
  historyIndexCache = JSON.parse(await fetchText(`${DATA_DIR}/history_index.json`));
  return historyIndexCache!;
}

/** Commits for one repository and year (one lazily loaded shard). */
export async function loadCommits(repo: string, year: string): Promise<Commit[]> {
  return loadChunk(`commits/${repo}/${year}.jsonl`) as Promise<Commit[]>;
}
export async function loadModules(): Promise<Module[]> {
  return loadChunk("modules.jsonl") as Promise<Module[]>;
}
export async function loadAddons(): Promise<AddOn[]> {
  return loadChunk("addons.jsonl") as Promise<AddOn[]>;
}
/**
 * Symbols and relationships are sharded per module (see atlas/sharding.py): shards/<repo>.json lists
 * the shards, their row counts and which shard declares each symbol, so a page loads only what it shows.
 */
export interface ShardIndex { keys: string[]; n: number[][]; s: Record<string, number> }
export type ShardKind = "symbols" | "relationships" | "incoming";
const KIND_AT: Record<ShardKind, number> = { symbols: 0, relationships: 1, incoming: 2 };

const shardIndexCache = new Map<string, Promise<ShardIndex>>();
export function loadShardIndex(repo: string): Promise<ShardIndex> {
  if (!shardIndexCache.has(repo)) shardIndexCache.set(repo, fetchText(`${DATA_DIR}/shards/${repo}.json`).then(t => JSON.parse(t)));
  return shardIndexCache.get(repo)!;
}
const shardFile = (kind: ShardKind, repo: string, key: string) => `${kind}/${repo}/${key.replace(/\//g, "__")}.jsonl`;
async function loadShards(repo: string, kind: ShardKind, keep: (key: string) => boolean = () => true): Promise<any[]> {
  const ix = await loadShardIndex(repo);
  const parts = await Promise.all(ix.keys.filter((k, i) => ix.n[i][KIND_AT[kind]] && keep(k)).map(k => loadChunk(shardFile(kind, repo, k))));
  return parts.flat();
}
/** Every symbol of a repository (all shards); prefer the narrower loaders below. */
export const loadRepoSymbols = (repo: string) => loadShards(repo, "symbols") as Promise<Symbol[]>;
export const loadRepoRelationships = (repo: string) => loadShards(repo, "relationships") as Promise<Relationship[]>;
export async function loadSymbols(): Promise<Symbol[]> {
  return (await Promise.all((await loadRepos()).map(r => loadRepoSymbols(r.name)))).flat();
}
/** Symbols under a module path: its own shards and any finer shards below it. */
export async function loadModuleSymbols(repo: string, modPath: string): Promise<Symbol[]> {
  const all = await loadShards(repo, "symbols", k => k === modPath || k.startsWith(modPath + "/")) as Symbol[];
  return all.filter(s => { const p = filePathOf(s.file); return p === modPath || p.startsWith(modPath + "/"); });
}
/** Outgoing edges of the files under a module path (its own shards and finer ones below it). */
export async function loadModuleRelationships(repo: string, modPath: string): Promise<Relationship[]> {
  return loadShards(repo, "relationships", k => k === modPath || k.startsWith(modPath + "/")) as Promise<Relationship[]>;
}
/** Edges from other shards whose target is a symbol under a module path. */
export async function loadModuleIncoming(repo: string, modPath: string): Promise<Relationship[]> {
  return loadShards(repo, "incoming", k => k === modPath || k.startsWith(modPath + "/")) as Promise<Relationship[]>;
}
/** Module-to-module edge counts: nodes are module ids, edges are [source, target, type, count]. */
export interface ModuleGraph { nodes: string[]; edges: [number, number, string, number, string][] }   // [source, target, type, count, evidence]
let moduleGraphCache: Promise<ModuleGraph> | null = null;
export function loadModuleGraph(): Promise<ModuleGraph> {
  if (!moduleGraphCache) moduleGraphCache = fetchText(`${DATA_DIR}/module_graph.json`).then(t => JSON.parse(t));
  return moduleGraphCache;
}
/** A symbol with its shard's symbols and edges, plus the edges that reach it from other shards. */
export async function loadSymbolShard(repo: string, symbolId: string) {
  const ix = await loadShardIndex(repo);
  const at = ix.s[symbolId.split(":").slice(2).join(":")];
  if (at === undefined) return null;
  const key = ix.keys[at];
  const [symbols, rels, incoming] = await Promise.all((["symbols", "relationships", "incoming"] as ShardKind[]).map(
    kind => ix.n[at][KIND_AT[kind]] ? loadChunk(shardFile(kind, repo, key)) : Promise.resolve([])));
  return { index: ix, symbols: symbols as Symbol[], rels: [...rels, ...incoming] as Relationship[] };
}
export async function loadDocs(): Promise<Doc[]> {
  return loadChunk("docs.jsonl") as Promise<Doc[]>;
}
export async function loadStories(): Promise<Story[]> {
  return loadChunk("stories.jsonl") as Promise<Story[]>;
}

export interface FileChange { id: string; commit: string; repository: string; path: string; change_type: string; old_path: string | null; additions: number; deletions: number }

/** Path of a symbol's file, from its file id `file:<repo>:<sha>:<path>`. */
export function filePathOf(fileId: string): string {
  return fileId.split(":").slice(3).join(":");
}

/** Short SHA from a commit id `commit:<repo>:<sha>`. */
export function shaOf(commitId: string): string {
  return commitId.split(":").pop()!;
}

/**
 * Find a commit by SHA without a global index: scan the repo's year shards, starting at the
 * hint year (parents are never newer than their children) and then going back in time.
 */
export async function findCommit(repo: string, sha: string, hintYear?: string): Promise<{ commit: Commit; year: string } | null> {
  const idx = await loadHistoryIndex();
  const years = Object.keys(idx[repo] ?? {}).sort().reverse();
  const ordered = hintYear && years.includes(hintYear)
    ? [hintYear, ...years.filter(y => y !== hintYear && y < hintYear), ...years.filter(y => y > hintYear)]
    : years;
  for (const year of ordered) {
    const hit = (await loadCommits(repo, year)).find(c => c.sha === sha || c.sha.startsWith(sha));
    if (hit) return { commit: hit, year };
  }
  return null;
}

export async function loadFileChanges(repo: string, year: string): Promise<FileChange[]> {
  return loadChunk(`files/${repo}/${year}.jsonl`) as Promise<FileChange[]>;
}

/** Build a pinned GitHub blob link for a file at a given repo SHA. */
export function githubBlob(repo: Repo, path: string, startLine?: number, endLine?: number): string {
  const anchor = startLine ? `#L${startLine}${endLine && endLine !== startLine ? `-L${endLine}` : ""}` : "";
  return `${repo.url.replace(/\.git$/, "")}/blob/${repo.sha}/${path}${anchor}`;
}

export function githubCommit(repo: Repo, sha: string): string {
  return `${repo.url.replace(/\.git$/, "")}/commit/${sha}`;
}

export interface SearchRecord { k: string; i: string; t: string; x?: string; u?: string | null; y?: string }
export type SearchGroup = "ecosystem" | "symbols" | "commits";

const searchCache = new Map<SearchGroup, Promise<SearchRecord[]>>();
/** One search group (search/<group>.json); loaded on first use, never at startup. */
export function loadSearchGroup(group: SearchGroup): Promise<SearchRecord[]> {
  if (!searchCache.has(group)) {
    searchCache.set(group, fetchText(`${DATA_DIR}/search/${group}.json`).then(t => JSON.parse(t)));
  }
  return searchCache.get(group)!;
}

export interface LanguageRow { id: string; repository: string; module: string; language: string; files: number; lines: number }
export async function loadLanguages(): Promise<LanguageRow[]> {
  return loadChunk("languages.jsonl") as Promise<LanguageRow[]>;
}

export const isDeprecated = (s: { annotations?: string[] }) => !!s.annotations?.includes("java.lang.Deprecated");

export interface Milestone { id: string; repository: string; title: string; date: string; commits: string[]; kind: string; version: string; tag: string; addon: string | null; release_notes: string | null }
export async function loadMilestones(): Promise<Milestone[]> {
  return loadChunk("milestones.jsonl") as Promise<Milestone[]>;
}
/** GitHub source tree at a release tag. */
export function githubTag(repo: Repo, tag: string): string {
  return `${repo.url.replace(/\.git$/, "")}/tree/${tag}`;
}

/** repo -> "YYYY-MM" -> [commits, distinct authors, lines added, lines deleted]; small, drives the zoomable timeline. */
export type Timeline = Record<string, Record<string, number[]>>;
let timelineCache: Promise<Timeline> | null = null;
export function loadTimeline(): Promise<Timeline> {
  if (!timelineCache) timelineCache = fetchText(`${DATA_DIR}/timeline.json`).then(t => JSON.parse(t));
  return timelineCache;
}

/** Module id -> first and last commit day, commits touching it and lines changed (added + deleted). */
export interface ModuleActivity { first: string; last: string; commits: number; lines: number }
let activityCache: Promise<Record<string, ModuleActivity>> | null = null;
export function loadModuleActivity(): Promise<Record<string, ModuleActivity>> {
  if (!activityCache) activityCache = fetchText(`${DATA_DIR}/module_activity.json`).then(t => JSON.parse(t));
  return activityCache;
}

/** Repository -> path -> [first day, last day, commits, lines changed] for files that currently declare symbols. */
export type FileActivity = Record<string, Record<string, [string, string, number, number]>>;
let fileActivityCache: Promise<FileActivity> | null = null;
export function loadFileActivity(): Promise<FileActivity> {
  if (!fileActivityCache) fileActivityCache = fetchText(`${DATA_DIR}/file_activity.json`).then(t => JSON.parse(t));
  return fileActivityCache;
}

/** Module id -> "YYYY-MM" -> [commits, distinct authors, lines added, lines deleted], on each file's current path. */
export type ModuleTimeline = Record<string, Record<string, number[]>>;
let sectionTimelineCache: Promise<ModuleTimeline> | null = null;
/** "path:<repo>:<directory>" or "lang:<repo>:<language>" -> month -> same row as ModuleTimeline. */
export function loadSectionTimeline(): Promise<ModuleTimeline> {
  if (!sectionTimelineCache) sectionTimelineCache = fetchText(`${DATA_DIR}/timeline_sections.json`).then(t => JSON.parse(t));
  return sectionTimelineCache;
}
let moduleTimelineCache: Promise<ModuleTimeline> | null = null;
export function loadModuleTimeline(): Promise<ModuleTimeline> {
  if (!moduleTimelineCache) moduleTimelineCache = fetchText(`${DATA_DIR}/timeline_modules.json`).then(t => JSON.parse(t));
  return moduleTimelineCache;
}

/** The core team over time, from the history of the help credits page: each person's listed intervals [from, to or null]. */
export interface CoreTeam { source: string; snapshots: number; first: string; people: { name: string; intervals: [string, string | null][] }[] }
let coreTeamCache: Promise<CoreTeam> | null = null;
export function loadCoreTeam(): Promise<CoreTeam> {
  if (!coreTeamCache) coreTeamCache = fetchText(`${DATA_DIR}/core_team.json`).then(t => JSON.parse(t));
  return coreTeamCache;
}
