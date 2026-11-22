import { useEffect, useState } from "react";
import { loadRepos, loadAddons, loadDocs, loadStories, loadSymbols } from "../lib/data";
import { Loading } from "../components/ui";

export default function Search() {
  const [q, setQ] = useState("");
  const [repos, setRepos] = useState<any[]>([]);
  const [addons, setAddons] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const [symbols, setSymbols] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [r, a, d, s, sy] = await Promise.all([
          loadRepos(), loadAddons(), loadDocs(), loadStories(), loadSymbols(),
        ]);
        setRepos(r); setAddons(a); setDocs(d); setStories(s); setSymbols(sy);
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <Loading />;

  const term = q.toLowerCase();
  const match = (arr: any[], field: string) => arr.filter(x =>
    (x[field] || "").toLowerCase().includes(term)
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Search</h1>
      <p className="text-slate-600">Search repositories, add-ons, docs, stories, and symbols.</p>
      <div className="mb-4">
        <input type="text" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)}
          className="w-full md:w-96 rounded border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
      </div>
      {q && (
        <div className="space-y-4">
          {match(repos, "name").length > 0 && (
            <div><div className="font-semibold mb-2">Repositories</div>
              {match(repos, "name").map(r => <div key={r.id} className="text-sm p-2 border rounded">{r.name}</div>)}
            </div>
          )}
          {match(addons, "name").length > 0 && (
            <div><div className="font-semibold mb-2">Add-ons</div>
              {match(addons, "name").map(r => <div key={r.id} className="text-sm p-2 border rounded">{r.name}</div>)}
            </div>
          )}
          {match(docs, "title").length > 0 && (
            <div><div className="font-semibold mb-2">Docs</div>
              {match(docs, "title").map(r => <div key={r.id} className="text-sm p-2 border rounded">{r.title}</div>)}
            </div>
          )}
          {match(stories, "title").length > 0 && (
            <div><div className="font-semibold mb-2">Stories</div>
              {match(stories, "title").map(r => <div key={r.id} className="text-sm p-2 border rounded">{r.title}</div>)}
            </div>
          )}
          {match(symbols, "qualified_name").length > 0 && (
            <div><div className="font-semibold mb-2">Symbols</div>
              {match(symbols, "qualified_name").slice(0, 20).map(r => <div key={r.id} className="text-sm p-2 border rounded">{r.qualified_name}</div>)}
            </div>
          )}
          {!term && <div className="text-sm text-slate-400 italic">Type to search.</div>}
        </div>
      )}
    </div>
  );
}
