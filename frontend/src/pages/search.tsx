import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SearchGroup, SearchRecord } from "../lib/data";
import { KIND_LABEL, PREFIXES, engine, parseQuery, routeFor } from "../lib/search";
import { ErrorBox } from "../components/ui";

const GROUPS: { id: SearchGroup; label: string; hint: string }[] = [
  { id: "ecosystem", label: "Repositories, add-ons, docs, stories", hint: "small" },
  { id: "symbols", label: "Types (classes, interfaces, enums)", hint: "larger download" },
  { id: "commits", label: "Commits", hint: "larger download" },
];

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
      <input type="search" autoFocus placeholder="Search…  (t: types, a: add-ons, c: commits, h: help pages)" aria-label="Search" value={q}
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
          {Object.entries(PREFIXES).map(([k, v]) => <span key={k} className="mr-2"><code className="px-1.5 py-0.5 rounded border border-slate-300 bg-slate-200 text-slate-900 font-semibold">{k}:</code> {v.label}</span>)}
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
