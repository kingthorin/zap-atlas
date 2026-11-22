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
  repository: "repo", module: "module", addon: "add-on", doc: "doc", story: "story", commit: "commit",
};

/** Internal route for a record, or null when it links outside (docs open GitHub at the pinned SHA). */
function routeFor(r: SearchRecord): string | null {
  const [, a, b] = r.i.split(/:(.*?):(.*)/s);
  switch (r.k) {
    case "repository": return "/repositories";
    case "module": return `/module/${a}/${b}`;
    case "addon": return `/addon/${encodeURIComponent(r.i)}`;
    case "story": return `/stories/${r.i.split(":").pop()}`;
    case "doc": return `/doc/${encodeURIComponent(r.i)}`;
    case "commit": return `/commit/${a}/${b}${r.y ? `?y=${r.y}` : ""}`;
    default: return `/symbol/${encodeURIComponent(r.i)}`; // class, interface, enum, ...
  }
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

  useEffect(() => {
    const run = ++seq.current;
    if (!q.trim()) { setResults({}); return; }
    (async () => {
      const out: Record<string, SearchRecord[]> = {};
      for (const g of enabled) {
        setLoading(l => new Set(l).add(g));
        try {
          const ms = await engine(g);
          out[g] = ms.search(q).slice(0, 50) as unknown as SearchRecord[];
        } catch (e: any) { setError(`${g}: ${e.message}`); }
        finally { setLoading(l => { const n = new Set(l); n.delete(g); return n; }); }
      }
      if (run === seq.current) setResults(out);
    })();
  }, [q, enabled]);

  const toggle = (g: SearchGroup) => setEnabled(prev => {
    const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n;
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Search</h1>
      <input type="search" autoFocus placeholder="Search…" aria-label="Search" value={q}
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
      {!q.trim() && <p className="text-sm text-slate-500 italic">Type to search. Indexes load on first use.</p>}
      {GROUPS.filter(g => enabled.has(g.id) && results[g.id]).map(g => (
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
