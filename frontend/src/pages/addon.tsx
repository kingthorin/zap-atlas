import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AddOn, Doc, Repo, loadAddons, loadDocs, loadModules, loadRepos } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);

export default function AddOnPage() {
  const { id = "" } = useParams();
  const [data, setData] = useState<{ addons: AddOn[]; docs: Doc[]; repos: Repo[]; modules: any[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([loadAddons(), loadDocs(), loadRepos(), loadModules()])
      .then(([addons, docs, repos, modules]) => setData({ addons, docs, repos, modules }))
      .catch(e => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const addon = data.addons.find(a => a.id === id);
  if (!addon) return <ErrorBox message={`Unknown add-on ${id}.`} />;

  const mod = data.modules.find(m => m.id === addon.module);
  const repo = data.repos.find(r => r.name === mod?.repository);
  const known = new Set(data.addons.map(a => a.id));
  const dependents = data.addons.filter(a => a.dependencies.includes(addon.id));
  const docs = data.docs.filter(d => d.module === addon.module);
  const url = safeUrl(addon.url);
  const addonLink = (a: string) => known.has(a)
    ? <Link className="text-indigo-600 hover:underline" to={`/addon/${encodeURIComponent(a)}`}>{a.replace("addon:", "")}</Link>
    : <span className="text-slate-500" title="not in this dataset">{a.replace("addon:", "")}</span>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{addon.name}</h1>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
        <dt className="text-slate-500">Id</dt><dd className="font-mono text-xs">{addon.id}</dd>
        <dt className="text-slate-500">Status</dt><dd>{addon.status || "not declared"}</dd>
        <dt className="text-slate-500">Author</dt><dd>{addon.author || "—"}</dd>
        <dt className="text-slate-500">Website</dt><dd>{url ? <a className="text-indigo-600 hover:underline" href={url}>{url}</a> : "—"}</dd>
        <dt className="text-slate-500">Module</dt>
        <dd>{mod && <Link className="text-indigo-600 hover:underline" to={`/module/${mod.repository}/${mod.path}`}>{mod.path}</Link>}</dd>
      </dl>
      <section>
        <h2 className="text-lg font-semibold mb-1">Depends on ({addon.dependencies.length})</h2>
        <ul className="text-sm flex flex-wrap gap-x-4">{addon.dependencies.map(d => <li key={d}>{addonLink(d)}</li>)}</ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-1">Required by ({dependents.length})</h2>
        <ul className="text-sm flex flex-wrap gap-x-4">{dependents.map(d => <li key={d.id}>{addonLink(d.id)}</li>)}</ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-1">Help topics ({docs.length})</h2>
        <ul className="text-sm divide-y divide-slate-100">
          {docs.map(d => (
            <li key={d.id} className="py-1">
              {repo ? <a className="text-indigo-600 hover:underline" href={`${repo.url.replace(/\.git$/, "")}/blob/${repo.sha}/${d.path}`}>{d.title}</a> : d.title}
              {d.headings.length > 1 && <span className="text-slate-400"> · {d.headings.slice(1, 4).join(" · ")}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
