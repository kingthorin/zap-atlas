import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Commit, FileChange, Repo, findCommit, loadFileChanges, loadRepos, shaOf } from "../lib/data";
import { Loading, ErrorBox, CopyForGitHub } from "../components/ui";

export default function CommitPage() {
  const { repo = "", sha = "" } = useParams();
  const [params] = useSearchParams();
  const [state, setState] = useState<{ commit: Commit; year: string; files: FileChange[]; repoRow?: Repo } | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setState(null); setMissing(false);
    (async () => {
      const hit = await findCommit(repo, sha, params.get("y") ?? undefined);
      if (!hit) { setMissing(true); return; }
      const [files, repos] = await Promise.all([loadFileChanges(repo, hit.year), loadRepos()]);
      setState({ ...hit, files: files.filter(f => f.commit === hit.commit.id), repoRow: repos.find(r => r.name === repo) });
    })().catch(e => setError(e.message));
  }, [repo, sha]);

  if (error) return <ErrorBox message={error} />;
  if (missing) return <ErrorBox message={`Commit ${sha} not found in ${repo}.`} />;
  if (!state) return <Loading />;

  const { commit: c, year, files, repoRow } = state;
  const base = repoRow?.url.replace(/\.git$/, "");
  return (
    <div className="space-y-6">
      <div className="text-sm"><Link to="/history" className="text-indigo-600 hover:underline">← History</Link></div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-2xl font-bold">{c.subject || <em>(no subject)</em>}</h1>
        <CopyForGitHub text={[
          `**${c.subject || "(no subject)"}**`, "",
          `- Repository: ${repo}`,
          base ? `- Commit: [\`${c.sha}\`](${base}/commit/${c.sha})` : `- Commit: \`${c.sha}\``,
          `- Author: ${c.author_name}, ${new Date(c.author_date).toISOString().slice(0, 10)}`,
          ...(c.tags.length ? [`- Tags: ${c.tags.join(", ")}`] : []),
          `- Files changed: ${files.length}`,
        ].join("\n")} />
      </div>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-y-1 text-sm">
        <dt className="text-slate-500">Repository</dt><dd>{repo}</dd>
        <dt className="text-slate-500">SHA</dt>
        <dd className="font-mono text-xs break-all">{c.sha}{base && <> · <a className="text-indigo-600 hover:underline" href={`${base}/commit/${c.sha}`}>view on GitHub</a></>}</dd>
        <dt className="text-slate-500">Author</dt><dd>{c.author_name}</dd>
        <dt className="text-slate-500">Date</dt><dd>{new Date(c.author_date).toUTCString()}</dd>
        <dt className="text-slate-500">Parents</dt>
        <dd className="font-mono text-xs break-all">
          {c.parents.length === 0 ? "root commit" : c.parents.map(p => (
            <Link key={p} className="mr-3 text-indigo-600 hover:underline" to={`/commit/${repo}/${shaOf(p)}?y=${year}`}>{shaOf(p).slice(0, 10)}</Link>
          ))}
          {c.parents.length > 1 && <span className="px-1.5 rounded bg-indigo-100 text-indigo-700">merge</span>}
        </dd>
        <dt className="text-slate-500">Branches</dt><dd>{c.branches.join(", ") || "—"}</dd>
        <dt className="text-slate-500">Tags</dt><dd>{c.tags.join(", ") || "—"}</dd>
      </dl>
      <pre className="whitespace-pre-wrap text-sm rounded border border-slate-200 bg-white p-3">{c.message}</pre>
      <section>
        <h2 className="text-lg font-semibold mb-2">Changed files ({files.length})</h2>
        {files.length === 0 ? <p className="text-sm text-slate-500 italic">No file changes recorded (for example a merge commit).</p> : (
          <table className="w-full text-sm border-collapse">
            <tbody className="divide-y divide-slate-100">
              {files.map(f => (
                <tr key={f.id}>
                  <td className="py-1 pr-3 w-10 font-mono text-slate-500">{f.change_type}</td>
                  <td className="py-1 break-all">
                    {base && f.change_type !== "D" ? <a className="text-indigo-600 hover:underline" href={`${base}/blob/${c.sha}/${f.path}`}>{f.path}</a> : f.path}
                    {f.old_path && <span className="text-slate-400"> ← {f.old_path}</span>}
                  </td>
                  <td className="py-1 pl-3 whitespace-nowrap font-mono text-xs"><span className="text-green-600">+{f.additions}</span> <span className="text-red-600">-{f.deletions}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
