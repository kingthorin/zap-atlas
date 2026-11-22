import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadCommits, loadHistoryIndex, HistoryIndex, shaOf } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

const PAGE = 100;

export default function History() {
  const [index, setIndex] = useState<HistoryIndex | null>(null);
  const [repo, setRepo] = useState("");
  const [year, setYear] = useState("");
  const [commits, setCommits] = useState<any[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const years = (r: string) => Object.keys(index?.[r] ?? {}).sort().reverse();

  useEffect(() => {
    loadHistoryIndex().then(i => {
      setIndex(i);
      const r = Object.keys(i)[0] ?? "";
      setRepo(r);
      setYear(Object.keys(i[r] ?? {}).sort().reverse()[0] ?? "");
    }).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!repo || !year) return;
    setLoading(true); setShown(PAGE);
    loadCommits(repo, year)
      .then(c => setCommits([...c].sort((a, b) => b.committer_date.localeCompare(a.committer_date))))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [repo, year]);

  if (error) return <ErrorBox message={error} />;
  if (!index) return <Loading />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Git history explorer</h1>
      <p className="text-slate-600">
        Full commit DAG preserved: merge parents, branches, tags, changed files,
        and renames. The DAG is not flattened into a date list.
      </p>
      <div className="flex flex-wrap gap-4 items-center text-sm">
        <label>Repository{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={repo}
            onChange={e => { setRepo(e.target.value); setYear(years(e.target.value)[0] ?? ""); }}>
            {Object.keys(index).map(r => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label>Year{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={year}
            onChange={e => setYear(e.target.value)}>
            {years(repo).map(y => <option key={y} value={y}>{y} ({index[repo][y].commits ?? 0})</option>)}
          </select>
        </label>
      </div>
      {loading ? <Loading /> : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="pb-2 pr-4">SHA</th><th className="pb-2">Parents</th>
              <th className="pb-2">Author</th><th className="pb-2">Date</th>
              <th className="pb-2">Subject</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {commits.slice(0, shown).map(c => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="pb-2 pr-4 text-[11px] font-mono text-slate-600 truncate max-w-[20%]">
                  <Link className="text-indigo-600 hover:underline" to={`/commit/${repo}/${c.sha}?y=${year}`}>{c.sha.slice(0,10)}</Link>
                </td>
                <td className="pb-2 text-[11px] font-mono text-slate-500">
                  {c.parents.length ? c.parents.map((p: string) => (
                    <Link key={p} className="mr-2 text-indigo-600 hover:underline" to={`/commit/${repo}/${shaOf(p)}?y=${year}`}>{shaOf(p).slice(0, 7)}</Link>
                  )) : "root"}
                  {c.parents.length > 1 && <span className="ml-2 px-1.5 rounded bg-indigo-100 text-indigo-700">merge</span>}
                </td>
                <td className="pb-2 text-slate-600">{c.author_name}</td>
                <td className="pb-2 text-slate-500">{new Date(c.author_date).toLocaleString()}</td>
                <td className="pb-2 text-slate-700">{c.subject}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {commits.length > shown && (
        <button className="px-3 py-1 rounded text-sm border border-slate-300 bg-white text-slate-700"
          onClick={() => setShown(shown + PAGE)}>Show more ({commits.length - shown} remaining)</button>
      )}
      <p className="text-xs text-slate-400">
        Showing {Math.min(shown, commits.length)} of {commits.length} commits, newest first. Raw author emails are never published — only
        normalized contributor identifiers.
      </p>
    </div>
  );
}
