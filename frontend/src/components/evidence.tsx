import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Commit, FileChange, Repo, findCommit, githubBlob, loadAddons, loadDocs, loadFileChanges, loadMilestones, loadModules, loadRepos, shaOf } from "../lib/data";
import { routeForEntity, safeHttps } from "../lib/routes";
import { CopyForGitHub } from "./ui";

interface Shown {
  title: string;
  rows: [string, React.ReactNode][];
  markdown: string;
  page: string | null;                 // the entity's own page in the Atlas
  extra?: React.ReactNode;
}

const gh = (repo: Repo | undefined) => repo?.url.replace(/\.git$/, "");
const link = (href: string | undefined, text: string) =>
  href && safeHttps(href) ? <a className="text-indigo-600 hover:underline break-all" href={href} rel="noopener noreferrer">{text}</a> : <>{text}</>;

/** What a cited id is, read from the dataset: shown beside the story so the reader keeps their place. */
async function describe(id: string): Promise<Shown> {
  const [kind, repoName] = id.split(":");
  const repos = await loadRepos();
  const repo = repos.find(r => r.name === repoName);
  const base = gh(repo);
  if (kind === "commit") {
    const hit = await findCommit(repoName, shaOf(id));
    if (!hit) throw new Error(`Commit ${shaOf(id)} is not in the dataset.`);
    const c: Commit = hit.commit;
    const files: FileChange[] = (await loadFileChanges(repoName, hit.year)).filter(f => f.commit === c.id);
    const url = base ? `${base}/commit/${c.sha}` : undefined;
    return {
      title: c.subject || "(no subject)", page: routeForEntity(id, hit.year),
      rows: [
        ["Repository", repoName],
        ["SHA", <span className="font-mono text-xs break-all">{c.sha}</span>],
        ["On GitHub", link(url, "permalink to the commit")],
        ["Author", `${c.author_name}, ${c.author_date.slice(0, 10)}`],
        ["Parents", c.parents.length ? <span className="font-mono text-xs">{c.parents.map(p => shaOf(p).slice(0, 10)).join(", ")}{c.parents.length > 1 ? " (a merge)" : ""}</span> : "none (the first commit)"],
        ["Branches", c.branches.join(", ") || "none"],
        ["Tags", c.tags.join(", ") || "none"],
        ["Files", `${files.length} changed`],
      ],
      extra: files.length > 0 && (
        <ul className="mt-2 text-xs space-y-0.5">
          {files.slice(0, 8).map(f => <li key={f.id} className="break-all">{f.change_type !== "D" && base ? link(`${base}/blob/${c.sha}/${f.path}`, f.path) : f.path}
            <span className="text-slate-500"> +{f.additions} -{f.deletions}</span></li>)}
          {files.length > 8 && <li className="text-slate-500">and {files.length - 8} more</li>}
        </ul>),
      markdown: [`**${c.subject || "(no subject)"}**`, "", `- Repository: ${repoName}`, `- Commit: [\`${c.sha}\`](${url})`,
        `- Author: ${c.author_name}, ${c.author_date.slice(0, 10)}`, ...(c.tags.length ? [`- Tags: ${c.tags.join(", ")}`] : []), `- Files changed: ${files.length}`].join("\n"),
    };
  }
  if (kind === "milestone") {
    const m = (await loadMilestones()).find(x => x.id === id);
    if (!m) throw new Error(`Release ${id} is not in the dataset.`);
    const tagUrl = base ? `${base}/releases/tag/${encodeURIComponent(m.tag)}` : undefined;
    return {
      title: m.title, page: routeForEntity(id),
      rows: [["Repository", m.repository], ["Tag", <span className="font-mono text-xs">{m.tag}</span>], ["Date", m.date.slice(0, 10)], ["Kind", m.kind],
        ["On GitHub", link(tagUrl, "the release or tag")], ["Release notes", m.release_notes ? link(m.release_notes, "release notes") : "none found"],
        ["Commits", `${m.commits.length} linked`]],
      markdown: [`**${m.title}**`, "", `- Tag: \`${m.tag}\` (${m.date.slice(0, 10)})`, ...(tagUrl ? [`- [On GitHub](${tagUrl})`] : [])].join("\n"),
    };
  }
  if (kind === "doc") {
    const d = (await loadDocs()).find(x => x.id === id);
    if (!d) throw new Error(`Help page ${id} is not in the dataset.`);
    const url = repo ? githubBlob(repo, d.path) : undefined;
    return {
      title: d.title, page: routeForEntity(id),
      rows: [["Repository", d.repository], ["Path", <span className="font-mono text-xs break-all">{d.path}</span>], ["On GitHub", link(url, "the page at the analysed commit")],
        ["Headings", d.headings.slice(0, 5).join(" · ") || "none"], ["History", d.commit_count ? `${d.commit_count} commits, last ${d.last_changed?.slice(0, 10) ?? "unknown"}` : "no history recorded"]],
      markdown: [`**${d.title}** (help page)`, "", `- Path: \`${d.path}\``, ...(url ? [`- [On GitHub](${url}) (pinned to the commit analysed)`] : [])].join("\n"),
    };
  }
  if (kind === "addon") {
    const a = (await loadAddons()).find(x => x.id === id);
    if (!a) throw new Error(`Add-on ${id} is not in the dataset.`);
    const mod = (await loadModules()).find(m => m.id === a.module);
    const url = repo && mod ? githubBlob(repo, mod.path).replace("/blob/", "/tree/") : undefined;
    return {
      title: a.name, page: routeForEntity(id),
      rows: [["Id", <span className="font-mono text-xs">{a.id.replace("addon:", "")}</span>], ["Status", a.status || "not declared"], ["Author", a.author || "unknown"],
        ["Depends on", a.dependencies.length ? a.dependencies.map(d => d.replace("addon:", "")).join(", ") : "nothing"], ["On GitHub", link(url, mod?.path ?? "the module")]],
      markdown: [`**${a.name}** (\`${a.id.replace("addon:", "")}\`)`, "", `- Status: ${a.status || "not declared"}`, ...(url ? [`- [Source](${url}) (pinned to the commit analysed)`] : [])].join("\n"),
    };
  }
  if (kind === "module") {
    const path = id.split(":").slice(2).join(":");
    const url = repo ? githubBlob(repo, path).replace("/blob/", "/tree/") : undefined;
    return { title: path, page: routeForEntity(id), rows: [["Repository", repoName], ["On GitHub", link(url, "the directory at the analysed commit")]],
      markdown: [`**\`${path}\`** in ${repoName}`, "", ...(url ? [`- [Source](${url}) (pinned to the commit analysed)`] : [])].join("\n") };
  }
  if (kind === "repo") {
    return { title: repoName, page: routeForEntity(id), rows: [["On GitHub", link(base, base ?? "")], ["Analysed commit", <span className="font-mono text-xs">{repo?.sha ?? "unknown"}</span>]],
      markdown: `**${repoName}**${base ? ` - ${base}` : ""}` };
  }
  return { title: id, page: routeForEntity(id), rows: [["Id", <span className="break-all">{id}</span>]], markdown: id };
}

/** A side panel over the right of the page; the story stays readable and scrollable beside it. */
export default function Evidence({ id, onClose }: { id: string; onClose: () => void }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { setShown(null); setError(""); describe(id).then(setShown).catch(e => setError(e.message)); }, [id]);
  useEffect(() => { panel.current?.focus(); }, [id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div ref={panel} tabIndex={-1} role="dialog" aria-label="Evidence"
      className="fixed top-0 right-0 z-40 h-full w-full sm:w-[26rem] overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-xl outline-none">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-slate-500">Evidence · {id.split(":")[0]}</div>
        <button type="button" onClick={onClose} className="px-2 py-0.5 rounded border border-slate-300 bg-white text-sm text-slate-700 hover:border-indigo-400">Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {!shown && !error && <p className="mt-3 text-sm italic text-slate-500">Loading…</p>}
      {shown && (
        <div className="mt-2 space-y-3">
          <h2 className="text-lg font-semibold break-words">{shown.title}</h2>
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-1 text-sm">
            {shown.rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="break-words">{v}</dd></div>)}
          </dl>
          {shown.extra}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {shown.page && <Link className="text-indigo-600 hover:underline" to={shown.page}>Open the full page</Link>}
            <CopyForGitHub text={shown.markdown} />
          </div>
        </div>
      )}
    </div>
  );
}
