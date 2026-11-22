import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LanguageRow, loadRepos, loadModules, loadLanguages } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

export default function Repositories() {
  const [repos, setRepos] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [langs, setLangs] = useState<LanguageRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([loadRepos(), loadModules(), loadLanguages()])
      .then(([r, m, l]) => { setRepos(r); setModules(m); setLangs(l); })
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
              <LanguageBars rows={langs.filter(l => l.repository === repo.name)} />
              <ul className="divide-y divide-slate-100">
                {mods.map(m => (
                  <li key={m.id} className="p-2">
                    <div className="font-medium truncate">
                      <Link className="text-indigo-600 hover:underline" to={`/module/${repo.name}/${m.path}`}>{m.name}</Link>
                      {m.addon && <Link className="ml-2 text-xs text-slate-500 hover:underline" to={`/addon/${encodeURIComponent(`addon:${m.name}`)}`}>add-on</Link>}
                    </div>
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

/** Lines per language for one repo, as a labelled table with bars (not colour-only). */
function LanguageBars({ rows }: { rows: LanguageRow[] }) {
  const totals = new Map<string, { files: number; lines: number }>();
  for (const r of rows) {
    const t = totals.get(r.language) ?? { files: 0, lines: 0 };
    t.files += r.files; t.lines += r.lines; totals.set(r.language, t);
  }
  const top = [...totals.entries()].filter(([, t]) => t.lines > 0).sort((a, b) => b[1].lines - a[1].lines).slice(0, 5);
  const max = top[0]?.[1].lines || 1;
  if (!top.length) return null;
  return (
    <table className="w-full text-xs mb-3" aria-label="Lines of code by language">
      <tbody>
        {top.map(([lang, t]) => (
          <tr key={lang}>
            <td className="pr-2 w-20">{lang}</td>
            <td className="w-full"><div className="h-2 rounded bg-indigo-500" style={{ width: `${Math.max(2, (t.lines / max) * 100)}%` }} /></td>
            <td className="pl-2 whitespace-nowrap text-right text-slate-500">{t.lines.toLocaleString()} lines · {t.files.toLocaleString()} files</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
