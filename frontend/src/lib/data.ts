/** Lightweight static-data loader for the Atlas dataset.

Loads chunked JSONL on demand and exposes typed accessors. Designed so the app
shell never downloads the whole dataset at startup.
*/

export interface Repo { id: string; name: string; url: string; default_branch: string; sha: string; description?: string }
export interface Commit { id: string; repository: string; sha: string; parents: string[]; author_name: string; author_date: string; committer_date: string; subject: string; message: string; branches: string[]; tags: string[] }
export interface Module { id: string; repository: string; name: string; path: string; kind: string; addon: boolean }
export interface AddOn { id: string; module: string; name: string; status: string; author: string; url: string; dependencies: string[] }
export interface Symbol { id: string; repository: string; file: string; qualified_name: string; kind: string; signature: string; start_line: number; end_line: number; resolution: string }
export interface Relationship { source: string; target: string; type: string; repository: string; evidence_type: string; source_file?: string; source_line?: number }
export interface Doc { id: string; repository: string; path: string; title: string; headings: string[]; anchors: string[] }
export interface Story { id: string; title: string; description: string; audience: string; chapters: any[]; entities: string[]; commits: string[]; documents: string[] }
export interface Manifest { schema_version: string; generator_version: string; generated_at: string; sources: any[]; inventory: any[]; coverage: any; chunks: string[] }

const DATA_DIR = import.meta.env.DEV ? "/data" : (import.meta.env.BASE_URL || "/") + "data";

let manifestCache: Manifest | null = null;
const jsonlCache = new Map<string, any[]>();

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return res.text();
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
export async function loadCommits(): Promise<Commit[]> {
  return loadChunk("commits.jsonl") as Promise<Commit[]>;
}
export async function loadModules(): Promise<Module[]> {
  return loadChunk("modules.jsonl") as Promise<Module[]>;
}
export async function loadAddons(): Promise<AddOn[]> {
  return loadChunk("addons.jsonl") as Promise<AddOn[]>;
}
export async function loadSymbols(): Promise<Symbol[]> {
  return loadChunk("symbols.jsonl") as Promise<Symbol[]>;
}
export async function loadRelationships(): Promise<Relationship[]> {
  return loadChunk("relationships.jsonl") as Promise<Relationship[]>;
}
export async function loadDocs(): Promise<Doc[]> {
  return loadChunk("docs.jsonl") as Promise<Doc[]>;
}
export async function loadStories(): Promise<Story[]> {
  return loadChunk("stories.jsonl") as Promise<Story[]>;
}

/** Build a pinned GitHub blob link for a file at a given repo SHA. */
export function githubBlob(repo: Repo, path: string): string {
  return `${repo.url.replace(/\.git$/, "")}/blob/${repo.sha}/${path}`;
}

export function githubCommit(repo: Repo, sha: string): string {
  return `${repo.url.replace(/\.git$/, "")}/commit/${sha}`;
}
