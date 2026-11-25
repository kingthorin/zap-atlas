import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AddOn, Doc, Milestone, Repo, loadAddons, loadDocs, loadMilestones, loadModules, loadRepos } from "../lib/data";
import { Loading, ErrorBox, CopyForGitHub } from "../components/ui";
import { githubBlob } from "../lib/data";

const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);

export default function AddOnPage() {
  const { id = "" } = useParams();
  const [data, setData] = useState<{ addons: AddOn[]; docs: Doc[]; repos: Repo[]; modules: any[]; releases: Milestone[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([loadAddons(), loadDocs(), loadRepos(), loadModules(), loadMilestones()])
      .then(([addons, docs, repos, modules, releases]) => setData({ addons, docs, repos, modules, releases }))
      .catch(e => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const addon = data.addons.find(a => a.id === id);
  if (!addon) return <ErrorBox message={`Unknown add-on ${id}.`} />;

  const mod = data.modules.find(m => m.id === addon.module);
  const known = new Set(data.addons.map(a => a.id));
  const dependents = data.addons.filter(a => a.dependencies.includes(addon.id));
  const docs = data.docs.filter(d => d.module === addon.module);
  const releases = data.releases.filter(r => r.addon === addon.id).sort((a, b) => b.date.localeCompare(a.date));
  const url = safeUrl(addon.url);
  const addonLink = (a: string) => known.has(a)
    ? <Link className="text-indigo-600 hover:underline" to={`/addon/${encodeURIComponent(a)}`}>{a.replace("addon:", "")}</Link>
    : <span className="text-slate-500" title="not in this dataset">{a.replace("addon:", "")}</span>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-2xl font-bold">{addon.name}</h1>
        <CopyForGitHub text={[
          `**${addon.name}** (\`${addon.id.replace("addon:", "")}\`)`, "",
          `- Status: ${addon.status || "not declared"}`,
          ...(releases[0] ? [`- Latest release tag: ${releases[0].version} (${releases[0].date.slice(0, 10)})`] : []),
          ...(mod && data.repos.find(r => r.name === mod.repository) ? [`- Source: [${mod.path}](${githubBlob(data.repos.find(r => r.name === mod.repository)!, mod.path).replace("/blob/", "/tree/")}) (pinned to the commit analysed)`] : []),
          ...(addon.dependencies.length ? [`- Depends on: ${addon.dependencies.map(d => d.replace("addon:", "")).join(", ")}`] : []),
          ...(url ? [`- Website: ${url}`] : []),
        ].join("\n")} />
      </div>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-y-1 text-sm">
        <dt className="text-slate-500">Id</dt><dd className="font-mono text-xs break-all">{addon.id}</dd>
        <dt className="text-slate-500">Status</dt><dd>{addon.status || "not declared"}</dd>
        <dt className="text-slate-500">Author</dt><dd>{addon.author || "—"}</dd>
        <dt className="text-slate-500">Website</dt><dd>{url ? <a className="text-indigo-600 hover:underline break-all" href={url}>{url}</a> : "—"}</dd>
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
        <h2 className="text-lg font-semibold mb-1">Releases ({releases.length})</h2>
        {releases.length === 0 ? <p className="text-sm text-slate-400 italic">No release tags found.</p> : (
          <ul className="text-sm flex flex-wrap gap-x-4">
            {releases.slice(0, 40).map(r => (
              <li key={r.id}><Link className="text-indigo-600 hover:underline" to={`/release/${encodeURIComponent(r.id)}`}>{r.version}</Link>
                <span className="text-xs text-slate-400"> {r.date.slice(0, 10)}</span></li>
            ))}
          </ul>
        )}
        {releases.length > 40 && <p className="text-xs text-slate-400 mt-1">Showing the newest 40. <Link className="text-indigo-600 hover:underline" to={`/releases?kind=addon-release&q=${encodeURIComponent(addon.id.replace("addon:", ""))}`}>All releases</Link></p>}
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-1">Help topics ({docs.length})</h2>
        <ul className="text-sm divide-y divide-slate-100">
          {docs.map(d => (
            <li key={d.id} className="py-1">
              <Link className="text-indigo-600 hover:underline" to={`/doc/${encodeURIComponent(d.id)}`}>{d.title}</Link>
              {d.headings.length > 1 && <span className="text-slate-400"> · {d.headings.slice(1, 4).join(" · ")}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
