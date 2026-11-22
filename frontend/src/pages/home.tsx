import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui";
import { loadRepos, loadAddons, loadDocs, loadManifest } from "../lib/data";

export default function Home() {
  const [repos, setRepos] = useState<any[]>([]);
  const [addons, setAddons] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [manifest, setManifest] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [r, a, d, m] = await Promise.all([
          loadRepos(), loadAddons(), loadDocs(), loadManifest(),
        ]);
        setRepos(r); setAddons(a); setDocs(d); setManifest(m);
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-4">Loading ecosystem…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">ZAP Atlas</h1>
        <p className="mt-2 text-slate-600">
          Interactive exploration of the ZAP ecosystem: core, add-ons, and
          documentation. All data is derived from pinned Git revisions — nothing
          is executed, no backend required.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Repositories" value={repos.length} />
        <StatCard label="Add-ons" value={addons.length} />
        <StatCard label="Help topics" value={docs.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader><CardTitle>Source repositories</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-200">
              {repos.map(r => (
                <li key={r.id} className="p-3">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-slate-500">{r.url}</div>
                  <div className="text-xs text-slate-400 mt-1">SHA: {r.sha?.slice(0,12)}</div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Generated at</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {manifest?.generated_at ? (
              <div className="text-slate-500">{new Date(manifest.generated_at).toUTCString()}</div>
            ) : (
              <span className="text-slate-400 italic">n/a</span>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-6 text-center">
        <div className="text-3xl font-bold text-indigo-600">{value}</div>
        <div className="text-sm text-slate-500 mt-2">{label}</div>
      </CardContent>
    </Card>
  );
}
