import { useEffect, useState } from "react";
import { loadCommits } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

export default function History() {
  const [commits, setCommits] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCommits()
      .then(c => setCommits(c.slice(0, 100)))
      .catch(e => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!commits.length) return <Loading />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Git history explorer</h1>
      <p className="text-slate-600">
        Full commit DAG preserved: merge parents, branches, tags, changed files,
        and renames. The DAG is not flattened into a date list.
      </p>
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
            {commits.map(c => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="pb-2 pr-4 text-[11px] font-mono text-slate-600 truncate max-w-[20%]">
                  {c.sha.slice(0,10)}
                </td>
                <td className="pb-2 text-[11px] font-mono text-slate-500">
                  {c.parents.map((p: string) => p.slice(0,7)).join(", ") || "—"}
                </td>
                <td className="pb-2 text-slate-600">{c.author_name}</td>
                <td className="pb-2 text-slate-500">{new Date(c.author_date).toLocaleString()}</td>
                <td className="pb-2 text-slate-700">{c.subject}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Showing first 100 commits. Raw author emails are never published — only
        normalized contributor identifiers.
      </p>
    </div>
  );
}
