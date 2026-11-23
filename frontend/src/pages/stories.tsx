import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Story, loadStories } from "../lib/data";
import { routeForEntity, safeHttps } from "../lib/routes";
import { Loading, ErrorBox } from "../components/ui";

const slugOf = (id: string) => id.split(":").pop()!;

function Badge({ status }: { status?: string }) {
  return status === "reviewed" ? null : (
    <span className="ml-2 px-1.5 rounded bg-amber-100 text-amber-800 text-xs align-middle" title="Not yet reviewed by a maintainer">draft</span>
  );
}

function RefLink({ id }: { id: string }) {
  const to = routeForEntity(id);
  const label = id.startsWith("commit:") ? `commit ${id.split(":").pop()!.slice(0, 10)}`
    : id.startsWith("milestone:") ? `release ${id.split(":").slice(2).join(":")}` : id.replace(/^[a-z]+:/, "");
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
  const { stories, error } = useStories();
  if (error) return <ErrorBox message={error} />;
  if (!stories) return <Loading />;
  const story: any = stories.find(s => slugOf(s.id) === slug);
  if (!story) return <ErrorBox message={`Unknown story ${slug}.`} />;
  return (
    <article className="space-y-6 max-w-3xl">
      <div className="text-sm"><Link to="/stories" className="text-indigo-600 hover:underline">← Stories</Link></div>
      <header>
        <div className="text-xs text-slate-400">{story.audience}</div>
        <h1 className="text-2xl font-bold">{story.title}<Badge status={story.status} /></h1>
        <p className="mt-2 text-slate-600">{story.description}</p>
      </header>
      <ol className="space-y-6">
        {story.chapters.map((ch: any, i: number) => (
          <li key={i}>
            <h2 className="text-lg font-semibold">{i + 1}. {ch.title}</h2>
            <p className="mt-1">{ch.text}</p>
            {[...(ch.entities ?? []), ...(ch.commits ?? []), ...(ch.documents ?? []), ...(ch.milestones ?? [])].length > 0 && (
              <ul className="mt-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
                {[...(ch.entities ?? []), ...(ch.commits ?? []), ...(ch.documents ?? []), ...(ch.milestones ?? [])].map((id: string) => <li key={id}><RefLink id={id} /></li>)}
              </ul>
            )}
            {(ch.evidence ?? []).map((e: any) => {
              const href = safeHttps(e.url);
              return href && <p key={e.url} className="mt-1 text-sm">Source: <a className="text-indigo-600 hover:underline" href={href} rel="noopener noreferrer">{e.label}</a></p>;
            })}
          </li>
        ))}
      </ol>
    </article>
  );
}

const GROUPS: { id: string; label: string; blurb: string }[] = [
  { id: "projects", label: "Student projects", blurb: "Student Hall of Fame and other mentored projects, from the term they started." },
  { id: "features", label: "Features and add-ons", blurb: "How a feature or add-on evolved, from the earliest event the story cites." },
  { id: "history", label: "Project history and organisation", blurb: "The repositories, the build, the branches and the team." },
];

const chip = (on: boolean) =>
  `px-3 py-1 rounded text-sm border ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300"}`;

export default function Stories() {
  const { stories, error } = useStories();
  const [params, setParams] = useSearchParams();
  const group = params.get("group") ?? "";
  if (error) return <ErrorBox message={error} />;
  if (!stories) return <Loading />;
  const byDate = (a: Story, b: Story) => (a.date ?? "").localeCompare(b.date ?? "") || a.title.localeCompare(b.title);
  const shown = GROUPS.filter(g => !group || g.id === group);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Curated stories</h1>
      <p className="text-slate-600">
        Evidence-backed narratives that cite commits, add-ons, releases and ZAP project pages. Stories marked
        <Badge status="draft" /> have not yet been reviewed by a maintainer. Cards in each group run oldest first.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Story group">
        <button aria-pressed={!group} className={chip(!group)} onClick={() => setParams({}, { replace: true })}>All ({stories.length})</button>
        {GROUPS.map(g => (
          <button key={g.id} aria-pressed={group === g.id} className={chip(group === g.id)} onClick={() => setParams({ group: g.id }, { replace: true })}>
            {g.label} ({stories.filter(s => s.group === g.id).length})
          </button>
        ))}
      </div>
      {stories.length === 0 && <p className="text-sm italic text-slate-500">No stories yet.</p>}
      {shown.map(g => {
        const items = stories.filter(s => s.group === g.id).sort(byDate);
        return items.length > 0 && (
          <section key={g.id} aria-labelledby={`grp-${g.id}`}>
            <h2 id={`grp-${g.id}`} className="text-xl font-semibold">{g.label}</h2>
            <p className="text-sm text-slate-500 mb-3">{g.blurb}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {items.map((story: any) => (
                <Link key={story.id} to={`/stories/${slugOf(story.id)}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-400">
                  <div className="text-xs text-slate-400 mb-1">{story.date} · {story.audience} · {story.chapters.length} chapters</div>
                  <h3 className="text-lg font-bold">{story.title}<Badge status={story.status} /></h3>
                  <p className="text-slate-600 text-sm mt-2">{story.description}</p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
