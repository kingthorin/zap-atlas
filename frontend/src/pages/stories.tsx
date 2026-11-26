import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Story, loadStories } from "../lib/data";
import { routeForEntity, safeHttps } from "../lib/routes";
import { Loading, ErrorBox } from "../components/ui";
import Evidence from "../components/evidence";

const slugOf = (id: string) => id.split(":").pop()!;

const COMPARE: Record<string, (a: Story, b: Story) => number> = {
  "date-asc": (a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.title.localeCompare(b.title),
  "date-desc": (a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title),
  "az": (a, b) => a.title.localeCompare(b.title),
  "za": (a, b) => b.title.localeCompare(a.title),
};
const isDraft = (s: Story) => s.status !== "reviewed";
/** The stories a list shows for these group, status and sort parameters. */
function filtered(stories: Story[], p: URLSearchParams) {
  const group = p.get("group") ?? "", status = p.get("status") ?? "";
  return stories.filter(s => (!group || s.group === group) && (!status || (status === "draft") === isDraft(s)))
    .sort(COMPARE[p.get("sort") ?? ""] ?? COMPARE["date-asc"]);
}

function Badge({ status }: { status?: string }) {
  return status === "reviewed" ? null : (
    <span className="ml-2 px-1.5 rounded bg-amber-100 text-amber-800 text-xs align-middle" title="Not yet reviewed by a maintainer">draft</span>
  );
}

const DRAWER_KINDS = new Set(["commit", "milestone", "doc", "addon", "module", "repo"]);

/** A citation: it opens the evidence panel beside the story (the panel links on to the full page). */
function RefLink({ id, open, onOpen }: { id: string; open: boolean; onOpen: (id: string) => void }) {
  const to = routeForEntity(id);
  const label = id.startsWith("commit:") ? `commit ${id.split(":").pop()!.slice(0, 10)}`
    : id.startsWith("milestone:") ? `release ${id.split(":").slice(2).join(":")}` : id.replace(/^[a-z]+:/, "");
  if (DRAWER_KINDS.has(id.split(":")[0]))
    return <button type="button" aria-expanded={open} onClick={() => onOpen(id)} title="Show the evidence beside the story"
      className={`text-left text-indigo-600 hover:underline break-all ${open ? "font-semibold underline" : ""}`}>{label}</button>;
  return to ? <Link className="text-indigo-600 hover:underline break-all" to={to}>{label}</Link> : <span>{label}</span>;
}

function useStories() {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { loadStories().then(setStories).catch(e => setError(e.message)); }, []);
  return { stories, error };
}

export function StoryDetail() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const fromList = !!(useLocation().state as any)?.fromList;      // reached from the list (not by a direct link)
  const { stories, error } = useStories();
  const [shown, setShown] = useState("");                       // the cited id whose evidence is open
  useEffect(() => setShown(""), [slug]);
  if (error) return <ErrorBox message={error} />;
  if (!stories) return <Loading />;
  const story: any = stories.find(s => slugOf(s.id) === slug);
  if (!story) return <ErrorBox message={`Unknown story ${slug}.`} />;
  const qs = ["group", "status", "sort"].filter(k => params.get(k)).map(k => `${k}=${encodeURIComponent(params.get(k)!)}`).join("&");
  const list = filtered(stories, params);
  const at = list.findIndex(s => s.id === story.id);
  const next = (qs || fromList) && at >= 0 ? list[at + 1] : undefined;      // only when reached from a filtered or sorted list
  return (
    <article className="space-y-6 max-w-3xl">
      <div className="text-sm flex justify-between gap-4">
        <Link to={qs ? `/stories?${qs}` : "/stories"} className="text-indigo-600 hover:underline">← Stories</Link>
        {next && <Link to={`/stories/${slugOf(next.id)}${qs ? `?${qs}` : ""}`} state={{ fromList: true }} className="text-indigo-600 hover:underline">{params.get("status") === "draft" ? "Next draft" : "Next story"} →</Link>}
      </div>
      <header>
        <h1 className="text-2xl font-bold">{story.title}<Badge status={story.status} /></h1>
        <p className="mt-2 text-slate-600">{story.description}</p>
      </header>
      {story.narrative && (
        <section aria-labelledby="short-version" className="space-y-3 max-w-prose">
          <h2 id="short-version" className="text-lg font-semibold">The short version</h2>
          {story.narrative.split(/\n\s*\n/).map((para: string, i: number) => <p key={i} className="leading-relaxed">{para}</p>)}
          {story.narrative_sources?.length > 0 && (
            <div>
              <h3 id="sources-h" className="font-semibold">Sources</h3>
              <ul className="mt-1 list-disc pl-5 text-sm" aria-labelledby="sources-h">
                {story.narrative_sources.map((src: { label: string; url: string }) => {
                  const href = safeHttps(src.url);
                  return <li key={src.url}>{href ? <a className="text-indigo-600 hover:underline" href={href} rel="noopener noreferrer">{src.label}</a> : src.label}</li>;
                })}
              </ul>
            </div>
          )}
        </section>
      )}
      {/* The chapters stay in the data, and show for a story that has no narrative yet. */}
      {!story.narrative && <ol className="space-y-6">
        {story.chapters.map((ch: any, i: number) => (
          <li key={i}>
            <h2 className="text-lg font-semibold">{i + 1}. {ch.title}</h2>
            <p className="mt-1">{ch.text}</p>
            {[...(ch.entities ?? []), ...(ch.commits ?? []), ...(ch.documents ?? []), ...(ch.milestones ?? [])].length > 0 && (
              <ul className="mt-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
                {[...(ch.entities ?? []), ...(ch.commits ?? []), ...(ch.documents ?? []), ...(ch.milestones ?? [])].map((id: string) => <li key={id}><RefLink id={id} open={shown === id} onOpen={x => setShown(s => (s === x ? "" : x))} /></li>)}
              </ul>
            )}
            {(ch.evidence ?? []).map((e: any) => {
              const href = safeHttps(e.url);
              return href && <p key={e.url} className="mt-1 text-sm">Source: <a className="text-indigo-600 hover:underline" href={href} rel="noopener noreferrer">{e.label}</a></p>;
            })}
          </li>
        ))}
      </ol>}
      {!story.narrative && shown && <Evidence id={shown} onClose={() => setShown("")} />}
    </article>
  );
}

const GROUPS: { id: string; label: string; short: string; blurb: string }[] = [
  { id: "projects", label: "Student projects", short: "Student project", blurb: "Student Hall of Fame and other mentored projects, from the term they started." },
  { id: "features", label: "Features and add-ons", short: "Feature", blurb: "How a feature or add-on evolved, from the earliest event the story cites." },
  { id: "history", label: "Project history and organisation", short: "History", blurb: "The repositories, the build, the branches and the team." },
];

const chip = (on: boolean) =>
  `px-3 py-1 rounded text-sm border ${on ? "bg-zap-orange-deep text-white border-zap-orange-deep" : "bg-white text-slate-700 border-slate-300"}`;

export default function Stories() {
  const { stories, error } = useStories();
  const [params, setParams] = useSearchParams();
  const group = params.get("group") ?? "";
  if (error) return <ErrorBox message={error} />;
  if (!stories) return <Loading />;
  const sort = params.get("sort") ?? "date-asc";
  const status = params.get("status") ?? "";
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };
  const items = filtered(stories, params);
  const inGroup = stories.filter(s => !group || s.group === group);
  const qs = ["group", "status", "sort"].filter(k => params.get(k)).map(k => `${k}=${encodeURIComponent(params.get(k)!)}`).join("&");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Curated stories</h1>
      <p className="text-slate-600">
        Evidence-backed narratives that cite commits, add-ons, releases and ZAP project pages. Stories marked
        <Badge status="draft" /> have not yet been reviewed by a maintainer. Each card is tagged with its group; use the group buttons to filter.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Story group">
        <button aria-pressed={!group} className={chip(!group)} onClick={() => setParam("group", "")}>All ({stories.length})</button>
        {GROUPS.map(g => (
          <button key={g.id} aria-pressed={group === g.id} className={chip(group === g.id)} onClick={() => setParam("group", g.id)}>
            {g.label} ({stories.filter(s => s.group === g.id).length})
          </button>
        ))}
        <label className="ml-auto text-sm text-slate-600">Sort{" "}
          <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={sort} onChange={e => setParam("sort", e.target.value === "date-asc" ? "" : e.target.value)}>
            <option value="date-asc">Date, oldest first</option>
            <option value="date-desc">Date, newest first</option>
            <option value="az">Title A to Z</option>
            <option value="za">Title Z to A</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Story status">
        <span className="text-sm text-slate-600">Status:</span>
        {([["", "All", inGroup.length], ["reviewed", "Reviewed", inGroup.filter(s => !isDraft(s)).length], ["draft", "Draft", inGroup.filter(isDraft).length]] as const).map(([id, label, n]) => (
          <button key={id} aria-pressed={status === id} className={chip(status === id)} onClick={() => setParam("status", id)}>{label} ({n})</button>
        ))}
      </div>
      {stories.length === 0 && <p className="text-sm italic text-slate-500">No stories yet.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {items.map((story: any) => (
          <Link key={story.id} to={`/stories/${slugOf(story.id)}${qs ? `?${qs}` : ""}`} state={{ fromList: true }} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-400">
            <div className="text-xs text-slate-400 mb-1">
              <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 mr-2">{GROUPS.find(g => g.id === story.group)?.short ?? story.group}</span>
              {story.date} · {story.chapters.length} chapters
            </div>
            <h3 className="text-lg font-bold">{story.title}<Badge status={story.status} /></h3>
            <p className="text-slate-600 text-sm mt-2">{story.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
