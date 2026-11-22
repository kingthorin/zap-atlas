import { useEffect, useState } from "react";
import { loadStories } from "../lib/data";
import { Loading, ErrorBox } from "../components/ui";

export default function Stories() {
  const [stories, setStories] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    loadStories().then(s => setStories(s)).catch(e => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!stories.length) return <Loading />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Curated stories</h1>
      <p className="text-slate-600">
        Human-authored, evidence-backed narratives. Automated milestones may
        suggest material, but only human-reviewed stories are presented here.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {stories.map(story => (
          <div key={story.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs text-slate-400 mb-1">{story.audience}</div>
            <h2 className="text-lg font-bold">{story.title}</h2>
            <p className="text-slate-600 text-sm mt-2">{story.description}</p>
            {story.entities?.length && (
              <div className="mt-3 text-xs text-slate-500">
                Entities: {story.entities.join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
