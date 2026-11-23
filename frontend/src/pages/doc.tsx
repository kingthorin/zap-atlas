import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Doc, Relationship, Repo, githubBlob, loadDocs, loadRepoRelationships, loadRepos, shaOf } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

export default function DocPage() {
  const { id = "" } = useParams();
  const repoName = id.split(":")[1] ?? "";
  const [data, setData] = useState<{ docs: Doc[]; rels: Relationship[]; repo?: Repo } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    Promise.all([loadDocs(), loadRepoRelationships(repoName), loadRepos()])
      .then(([docs, rels, repos]) => setData({ docs, rels, repo: repos.find(r => r.name === repoName) }))
      .catch(e => setError(e.message));
  }, [id]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const doc = data.docs.find(d => d.id === id);
  if (!doc) return <ErrorBox message={`Unknown help page ${id}.`} />;

  const byId = new Map(data.docs.map(d => [d.id, d]));
  const refs = data.rels.filter(r => r.type === "REFERENCES");
  const outgoing = refs.filter(r => r.source === id).map(r => byId.get(r.target)).filter(Boolean) as Doc[];
  const incoming = refs.filter(r => r.target === id).map(r => byId.get(r.source)).filter(Boolean) as Doc[];
  const list = (docs: Doc[]) => docs.length === 0 ? <p className="text-sm text-slate-400 italic">None.</p> : (
    <ul className="text-sm">{docs.map(d => <li key={d.id}><Link className="text-indigo-600 hover:underline" to={`/doc/${encodeURIComponent(d.id)}`}>{d.title}</Link></li>)}</ul>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{doc.title}</h1>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-y-1 text-sm">
        <dt className="text-slate-500">Path</dt>
        <dd className="font-mono text-xs break-all">{data.repo ? <a className="text-indigo-600 hover:underline" href={githubBlob(data.repo, doc.path)}>{doc.path}</a> : doc.path}</dd>
        <dt className="text-slate-500">Module</dt>
        <dd>{doc.module && <Link className="text-indigo-600 hover:underline" to={`/module/${repoName}/${doc.module.split(":").slice(2).join(":")}`}>{doc.module.split(":").slice(2).join(":")}</Link>}</dd>
        <dt className="text-slate-500">History</dt>
        <dd>{doc.commit_count ?? 0} commits{doc.last_changed && <>, last changed {new Date(doc.last_changed).toUTCString()}</>}</dd>
      </dl>
      {doc.headings.length > 1 && (
        <section><h2 className="text-lg font-semibold mb-1">Sections</h2>
          <ul className="text-sm list-disc pl-5">{doc.headings.slice(1).map((h, i) => <li key={i}>{h}</li>)}</ul></section>
      )}
      <section><h2 className="text-lg font-semibold mb-1">Links to ({outgoing.length})</h2>{list(outgoing)}</section>
      <section><h2 className="text-lg font-semibold mb-1">Linked from ({incoming.length})</h2>{list(incoming)}</section>
      {(doc.commits?.length ?? 0) > 0 && (
        <section><h2 className="text-lg font-semibold mb-1">Recent commits</h2>
          <ul className="text-sm font-mono flex flex-wrap gap-x-3">
            {doc.commits!.slice(0, 20).map(c => <li key={c}><Link className="text-indigo-600 hover:underline" to={`/commit/${repoName}/${shaOf(c)}`}>{shaOf(c).slice(0, 10)}</Link></li>)}
          </ul>
          {doc.commit_count! > 20 && <p className="text-xs text-slate-400 mt-1">Showing 20 of {doc.commit_count}.</p>}
        </section>
      )}
    </div>
  );
}
