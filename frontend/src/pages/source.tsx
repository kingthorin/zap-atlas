import { useEffect, useState } from "react";
import { loadSymbols } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

export default function Source() {
  const [symbols, setSymbols] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    loadSymbols().then(s => setSymbols(s)).catch(e => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!symbols.length) return <Loading />;

  const filtered = symbols.filter(s =>
    s.qualified_name.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Source explorer</h1>
      <p className="text-slate-600">
        File tree, symbol outline, and references with exact-revision GitHub
        links. Symbols carry syntactic resolution by default.
      </p>
      <div className="mb-4">
        <input type="text" placeholder="Filter symbols…" value={q}
          onChange={e => setQ(e.target.value)}
          className="w-full md:w-96 rounded border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="pb-2">Kind</th><th className="pb-2 pl-4">Symbol</th>
              <th className="pb-2 pl-4">File</th><th className="pb-2">Lines</th>
              <th className="pb-2">Resolution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.slice(0, 200).map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="pb-2 text-slate-600">{s.kind}</td>
                <td className="pb-2 pl-4 text-slate-700 truncate max-w-[40%]">{s.qualified_name}</td>
                <td className="pb-2 pl-4 text-[11px] font-mono text-slate-500">{s.file}</td>
                <td className="pb-2 text-slate-600">{s.start_line}-{s.end_line}</td>
                <td className="pb-2 text-slate-400">{s.resolution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
