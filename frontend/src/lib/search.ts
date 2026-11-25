import MiniSearch from "minisearch";
import { SearchGroup, SearchRecord, loadSearchGroup } from "./data";

export const KIND_LABEL: Record<string, string> = {
  repository: "repo", module: "module", addon: "add-on", doc: "doc", story: "story", commit: "commit", release: "release",
};

/** Internal route for a record, or null when it links outside (docs open GitHub at the pinned SHA). */
export function routeFor(r: SearchRecord): string | null {
  const [, a, b] = r.i.split(/:(.*?):(.*)/s);
  switch (r.k) {
    case "repository": return "/repositories";
    case "module": return `/module/${a}/${b}`;
    case "addon": return `/addon/${encodeURIComponent(r.i)}`;
    case "release": return `/release/${encodeURIComponent(r.i)}`;
    case "story": return `/stories/${r.i.split(":").pop()}`;
    case "doc": return `/doc/${encodeURIComponent(r.i)}`;
    case "commit": return `/commit/${a}/${b}${r.y ? `?y=${r.y}` : ""}`;
    default: return `/symbol/${encodeURIComponent(r.i)}`; // class, interface, enum, ...
  }
}

/** `t:Scanner`, `a:pscan`, `c:abc123`, `h:spider`, `m:zest`, `s:logo`: search one kind of thing. */
export const PREFIXES: Record<string, { group: SearchGroup; label: string; kinds?: string[]; not?: string[] }> = {
  t: { group: "symbols", label: "types" },
  a: { group: "ecosystem", label: "add-ons", kinds: ["addon"] },
  c: { group: "commits", label: "commits" },
  h: { group: "ecosystem", label: "help pages", kinds: ["doc"] },
  m: { group: "ecosystem", label: "modules", kinds: ["module"] },
  s: { group: "ecosystem", label: "stories", kinds: ["story"] },
  r: { group: "ecosystem", label: "releases", kinds: ["release"] },
};
export function parseQuery(q: string): { prefix: string; term: string } {
  const m = /^([a-z]):\s*(.*)$/s.exec(q.trimStart());
  return m && PREFIXES[m[1]] ? { prefix: m[1], term: m[2] } : { prefix: "", term: q };
}

const engines = new Map<SearchGroup, MiniSearch<SearchRecord>>();
export async function engine(group: SearchGroup): Promise<MiniSearch<SearchRecord>> {
  const cached = engines.get(group);
  if (cached) return cached;
  const ms = new MiniSearch<SearchRecord>({
    idField: "i", fields: ["t", "x"], storeFields: ["k", "i", "t", "u", "y"],
    searchOptions: { prefix: true, combineWith: "AND", boost: { t: 2 } },
  });
  ms.addAll(await loadSearchGroup(group));
  engines.set(group, ms);
  return ms;
}

