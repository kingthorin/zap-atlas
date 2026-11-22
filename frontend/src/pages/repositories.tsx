import { useEffect, useState } from "react";
import { loadRepos, loadModules } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

export default function Repositories() {
  const [repos, setRepos] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([loadRepos(), loadModules()])
      .then(([r, m]) => { setRepos(r); setModules(m); })
      .catch(e => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!repos.length && !modules.length) return <Loading />;

  const byRepo: Record<string, any[]> = {};
  for (const m of modules) {
    (byRepo[m.repository] ||= []).push(m);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Repositories</h1>
      <p className="text-slate-600">
        Module boundaries discovered from Gradle. Each add-on is a Gradle
        module with its own ZapAddOn.xml metadata.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {repos.map(repo => {
          const mods = byRepo[repo.name] || [];
          return (
            <div key={repo.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="font-semibold">{repo.name}</span>
                <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">{mods.length} modules</span>
              </div>
              <div className="text-xs text-slate-500 mb-3">{repo.url}</div>
              <div className="text-sm font-mono text-slate-400 mb-3">SHA {repo.sha?.slice(0,10)}…</div>
              <ul className="divide-y divide-slate-100">
                {mods.map(m => (
                  <li key={m.id} className="p-2">
                    <div className="font-medium truncate">{m.name}</div>
                    <div className="text-xs text-slate-500">{m.path}</div>
                  </li>
                ))}
                {mods.length === 0 && <div className="text-xs text-slate-400 p-2 italic">no modules discovered</div>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
