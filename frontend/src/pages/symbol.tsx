import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Relationship, Repo, Symbol, filePathOf, githubBlob, isDeprecated, loadRepos, loadShardIndex, loadSymbolShard } from "../lib/data";
import { Loading, ErrorBox, CopyForGitHub } from "../components/ui";

export default function SymbolPage() {
  const { id = "" } = useParams();
  const repoName = id.split(":")[1] ?? "";
  const [data, setData] = useState<{ symbols: Symbol[]; rels: Relationship[]; known: (id: string) => boolean; repo?: Repo } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    Promise.all([loadSymbolShard(repoName, id), loadShardIndex(repoName), loadRepos()])
      .then(([shard, index, repos]) => setData({
        symbols: shard?.symbols ?? [], rels: shard?.rels ?? [],
        known: x => x.split(":")[1] === repoName && x.split(":").slice(2).join(":") in index.s,
        repo: repos.find(r => r.name === repoName),
      }))
      .catch(e => setError(e.message));
  }, [id]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const sym = data.symbols.find(s => s.id === id);
  if (!sym) return <ErrorBox message={`Unknown symbol ${id}.`} />;

  const node = (x: string) => data.known(x)
    ? <Link className="text-indigo-600 hover:underline" to={`/symbol/${encodeURIComponent(x)}`}>{x.split(":").slice(2).join(":")}</Link>
    : <span className="text-slate-500" title="not resolved to a declaration in this dataset">{x.split(":").slice(2).join(":") || x}</span>;
  const out = data.rels.filter(r => r.source === id);
  const inc = data.rels.filter(r => r.target === id);
  const path = filePathOf(sym.file);
  const row = (r: Relationship, other: string) => (
    <li key={`${r.type}-${r.source}-${r.target}-${r.source_line}`} className="py-1 break-all">
      <span className="text-xs text-slate-400 mr-2 inline-block w-20">{r.type}</span>{node(other)}
      <span className="ml-2 text-xs text-slate-400">{r.evidence_type}</span>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-2xl font-bold break-all">{sym.signature}</h1>
        <CopyForGitHub text={[
          `**\`${sym.qualified_name}\`** (${sym.kind}${isDeprecated(sym) ? ", deprecated" : ""})`, "",
          `- Resolution: ${sym.resolution}`,
          `- Repository: ${repoName}`,
          `- Outgoing links: ${out.length}, incoming: ${inc.length}`,
          data.repo ? `- Source: [${path}:${sym.start_line}-${sym.end_line}](${githubBlob(data.repo, path, sym.start_line, sym.end_line)}) (pinned to the commit analysed)` : `- Source: ${path}:${sym.start_line}-${sym.end_line}`,
        ].join("\n")} />
      </div>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-y-1 text-sm">
        <dt className="text-slate-500">Kind</dt><dd>{sym.kind}</dd>
        <dt className="text-slate-500">Qualified name</dt><dd className="font-mono text-xs break-all">{sym.qualified_name}</dd>
        <dt className="text-slate-500">Resolution</dt><dd>{sym.resolution}</dd>
        <dt className="text-slate-500">Annotations</dt>
        <dd>{sym.annotations?.length ? sym.annotations.map(a => <span key={a} className="mr-2 font-mono text-xs">@{a}</span>) : "—"}
          {isDeprecated(sym) && <span className="ml-1 px-1 rounded bg-amber-100 text-amber-800 text-xs">deprecated</span>}</dd>
        <dt className="text-slate-500">Source</dt>
        <dd className="break-all">{data.repo
          ? <a className="text-indigo-600 hover:underline" href={githubBlob(data.repo, path, sym.start_line, sym.end_line)}>{path}:{sym.start_line}-{sym.end_line}</a>
          : `${path}:${sym.start_line}-${sym.end_line}`}</dd>
      </dl>
      <section><h2 className="text-lg font-semibold mb-1">Outgoing ({out.length})</h2>
        <ul className="text-sm divide-y divide-slate-100">{out.slice(0, 200).map(r => row(r, r.target))}</ul></section>
      <section><h2 className="text-lg font-semibold mb-1">Incoming ({inc.length})</h2>
        <ul className="text-sm divide-y divide-slate-100">{inc.slice(0, 200).map(r => row(r, r.source))}</ul></section>
    </div>
  );
}
