import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Repo, Symbol, filePathOf, githubBlob, loadRepoSymbols, loadRepos } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

const INDENT: Record<string, string> = { method: "pl-6", constructor: "pl-6", field: "pl-6" };

function FileNode({ path, symbols, repo }: { path: string; symbols: Symbol[]; repo?: Repo }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={e => setOpen((e.target as HTMLDetailsElement).open)} className="py-1">
      <summary className="cursor-pointer text-sm font-mono break-all">{path} <span className="text-slate-400">({symbols.length})</span></summary>
      {open && (
        <ul className="mt-1 text-sm">
          {[...symbols].sort((a, b) => a.start_line - b.start_line).map(s => (
            <li key={s.id} className={INDENT[s.kind] ?? ""}>
              <span className="text-xs text-slate-400 mr-2">{s.kind}</span>
              <Link className="text-indigo-600 hover:underline" to={`/symbol/${encodeURIComponent(s.id)}`}>{s.signature}</Link>
              {repo && <a className="ml-2 text-xs text-slate-400 hover:underline" href={githubBlob(repo, path, s.start_line, s.end_line)}>L{s.start_line}</a>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export default function ModulePage() {
  const { repo = "", "*": modPath = "" } = useParams();
  const [symbols, setSymbols] = useState<Symbol[] | null>(null);
  const [repoRow, setRepoRow] = useState<Repo>();
  const [error, setError] = useState("");
  const [shown, setShown] = useState(100);

  useEffect(() => {
    setSymbols(null);
    Promise.all([loadRepoSymbols(repo), loadRepos()])
      .then(([s, r]) => { setSymbols(s); setRepoRow(r.find(x => x.name === repo)); })
      .catch(e => setError(e.message));
  }, [repo]);

  const files = useMemo(() => {
    const byFile = new Map<string, Symbol[]>();
    for (const s of symbols ?? []) {
      const p = filePathOf(s.file);
      if (p === modPath || p.startsWith(modPath + "/")) (byFile.get(p) ?? byFile.set(p, []).get(p)!).push(s);
    }
    return [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [symbols, modPath]);

  if (error) return <ErrorBox message={error} />;
  if (!symbols) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="text-sm"><Link to="/repositories" className="text-indigo-600 hover:underline">← Repositories</Link></div>
      <h1 className="text-2xl font-bold">{modPath}</h1>
      <p className="text-sm text-slate-500">
        {repo} · {files.length} Java files with symbols · current structure at the pinned revision
        {repoRow && <> · <a className="text-indigo-600 hover:underline" href={`${repoRow.url.replace(/\.git$/, "")}/tree/${repoRow.sha}/${modPath}`}>view on GitHub</a></>}
      </p>
      {files.length === 0 && <p className="text-sm italic text-slate-500">No Java symbols found under this module.</p>}
      <div className="divide-y divide-slate-100">
        {files.slice(0, shown).map(([path, syms]) => <FileNode key={path} path={path} symbols={syms} repo={repoRow} />)}
      </div>
      {files.length > shown && (
        <button className="px-3 py-1 rounded text-sm border border-slate-300 bg-white text-slate-700" onClick={() => setShown(shown + 100)}>
          Show more ({files.length - shown} remaining)
        </button>
      )}
    </div>
  );
}
