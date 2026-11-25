import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import MiniSearch from "minisearch";
import { SearchGroup, SearchRecord, loadSearchGroup } from "../lib/data";
import { ErrorBox } from "../components/ui";

const GROUPS: { id: SearchGroup; label: string; hint: string }[] = [
  { id: "ecosystem", label: "Repositories, add-ons, docs, stories", hint: "small" },
  { id: "symbols", label: "Types (classes, interfaces, enums)", hint: "larger download" },
  { id: "commits", label: "Commits", hint: "larger download" },
];

const KIND_LABEL: Record<string, string> = {
  repository: "repo", module: "module", addon: "add-on", doc: "doc", story: "story", commit: "commit", release: "release",
};

/** Internal route for a record, or null when it links outside (docs open GitHub at the pinned SHA). */
function routeFor(r: SearchRecord): string | null {
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
const PREFIXES: Record<string, { group: SearchGroup; label: string; kinds?: string[]; not?: string[] }> = {
  t: { group: "symbols", label: "types" },
  a: { group: "ecosystem", label: "add-ons", kinds: ["addon"] },
  c: { group: "commits", label: "commits" },
  h: { group: "ecosystem", label: "help pages", kinds: ["doc"] },
  m: { group: "ecosystem", label: "modules", kinds: ["module"] },
  s: { group: "ecosystem", label: "stories", kinds: ["story"] },
  r: { group: "ecosystem", label: "releases", kinds: ["release"] },
};
function parseQuery(q: string): { prefix: string; term: string } {
  const m = /^([a-z]):\s*(.*)$/s.exec(q.trimStart());
  return m && PREFIXES[m[1]] ? { prefix: m[1], term: m[2] } : { prefix: "", term: q };
}

const engines = new Map<SearchGroup, MiniSearch<SearchRecord>>();
async function engine(group: SearchGroup): Promise<MiniSearch<SearchRecord>> {
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

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [enabled, setEnabled] = useState<Set<SearchGroup>>(new Set(["ecosystem", "symbols"]));
  const [loading, setLoading] = useState<Set<SearchGroup>>(new Set());
  const [results, setResults] = useState<Record<string, SearchRecord[]>>({});
  const [error, setError] = useState("");
  const seq = useRef(0);

  const { prefix, term } = parseQuery(q);
  const only = prefix ? PREFIXES[prefix] : null;
  const groups = only ? [only.group] : [...enabled];       // a prefix searches its own group, whatever is ticked
  useEffect(() => {
    const run = ++seq.current;
    if (!term.trim()) { setResults({}); return; }
    (async () => {
      const out: Record<string, SearchRecord[]> = {};
      for (const g of groups) {
        setLoading(l => new Set(l).add(g));
        try {
          const ms = await engine(g);
          let hits = ms.search(term) as unknown as SearchRecord[];
          if (only?.kinds) hits = hits.filter(h => only.kinds!.includes(h.k));
          out[g] = hits.slice(0, 50);
        } catch (e: any) { setError(`${g}: ${e.message}`); }
        finally { setLoading(l => { const n = new Set(l); n.delete(g); return n; }); }
      }
      if (run === seq.current) setResults(out);
    })();
  }, [q, enabled]);   // groups and term follow from these two

  const toggle = (g: SearchGroup) => setEnabled(prev => {
    const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n;
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Search</h1>
      <input type="search" autoFocus placeholder="Search…  (t: types, a: add-ons, c: commits, h: help pages)" data-search-input aria-label="Search" value={q}
        onChange={e => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
        className="w-full md:w-96 rounded border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
      <fieldset className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <legend className="sr-only">Search in</legend>
        {GROUPS.map(g => (
          <label key={g.id} className="flex items-center gap-2">
            <input type="checkbox" checked={enabled.has(g.id)} onChange={() => toggle(g.id)} />
            {g.label} <span className="text-xs text-slate-400">({g.hint})</span>
            {loading.has(g.id) && <span className="text-xs text-slate-400 italic">loading…</span>}
          </label>
        ))}
      </fieldset>
      {error && <ErrorBox message={error} />}
      {!q.trim() && (
        <p className="text-sm text-slate-500">
          <span className="italic">Type to search. Indexes load on first use.</span>{" "}
          Start with a letter and a colon to search one kind:{" "}
          {Object.entries(PREFIXES).map(([k, v]) => <span key={k} className="mr-2"><code className="px-1 rounded bg-slate-100">{k}:</code> {v.label}</span>)}
        </p>
      )}
      {only && term.trim() && <p className="text-xs text-slate-500">Searching {only.label} only.</p>}
      {GROUPS.filter(g => groups.includes(g.id) && results[g.id]).map(g => (
        <section key={g.id}>
          <h2 className="font-semibold mb-1">{g.label} <span className="text-xs text-slate-400">({results[g.id].length}{results[g.id].length === 50 ? "+" : ""})</span></h2>
          {results[g.id].length === 0 ? <p className="text-sm text-slate-400 italic">No matches.</p> : (
            <ul className="text-sm divide-y divide-slate-100">
              {results[g.id].map(r => {
                const to = routeFor(r);
                return (
                  <li key={r.i} className="py-1 flex gap-3">
                    <span className="w-16 shrink-0 text-xs text-slate-400">{KIND_LABEL[r.k] ?? r.k}</span>
                    {to ? <Link className="text-indigo-600 hover:underline break-all" to={to}>{r.t || r.i}</Link>
                        : <a className="text-indigo-600 hover:underline break-all" href={r.u ?? "#"}>{r.t}</a>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
