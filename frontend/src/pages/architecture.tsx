import { useEffect, useState } from "react";
import { loadRelationships, loadSymbols } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

export default function Architecture() {
  const [rels, setRels] = useState<any[]>([]);
  const [symbols, setSymbols] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    Promise.all([loadRelationships(), loadSymbols()])
      .then(([r, s]) => { setRels(r); setSymbols(s); })
      .catch(e => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!rels.length && !symbols.length) return <Loading />;

  const types = [...new Set(rels.map(r => r.type))];
  const filtered = typeFilter ? rels.filter(r => r.type === typeFilter) : rels;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Architecture explorer</h1>
      <p className="text-slate-600">
        Evidence-aware relationships. Every edge records source/target IDs,
        type, repository, source revision, evidence type (syntactic,
        inferred, resolved), and source file/line. Syntactic edges are
        distinguishable from resolved ones.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setTypeFilter("")}
          className={`px-3 py-1 rounded text-sm border ${!typeFilter ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300"}`}>
          All
        </button>
        {types.map(t => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={`px-3 py-1 rounded text-sm border ${typeFilter === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="pb-2">Source</th><th className="pb-2 pl-4">Type</th>
              <th className="pb-2 pl-4">Target</th><th className="pb-2">Evidence</th>
              <th className="pb-2">File:Line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.slice(0, 200).map(r => (
              <tr key={`${r.source}-${r.target}-${r.type}`} className="hover:bg-slate-50">
                <td className="pb-2 truncate max-w-[30%] text-slate-600">{r.source}</td>
                <td className="pb-2 pl-4 text-slate-600">{r.type}</td>
                <td className="pb-2 pl-4 truncate max-w-[30%]">{r.target}</td>
                <td className="pb-2 text-slate-400">{r.evidence_type}</td>
                <td className="pb-2 text-[11px] text-slate-400 font-mono">
                  {r.source_file || "—"}{r.source_line != null ? `:${r.source_line}` : ""}
                </td>
              </tr>
            ))}
            {filtered.length > 200 && (
              <tr><td colSpan={5} className="p-2 text-xs text-slate-400 italic">
                Showing 200 of {filtered.length} relationships (use filters).
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
