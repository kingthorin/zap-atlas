/** Internal route for an entity id, or null if it has no page (e.g. docs open GitHub instead). */
export function routeForEntity(id: string, commitYearHint?: string): string | null {
  const parts = id.split(":");
  const [kind, a] = parts;
  const b = parts.slice(2).join(":");
  switch (kind) {
    case "repo": return "/repositories";
    case "module": return `/module/${a}/${b}`;
    case "addon": return `/addon/${encodeURIComponent(id)}`;
    case "commit": return `/commit/${a}/${b}${commitYearHint ? `?y=${commitYearHint}` : ""}`;
    case "symbol": return `/symbol/${encodeURIComponent(id)}`;
    case "doc": return `/doc/${encodeURIComponent(id)}`;
    case "milestone": return `/release/${encodeURIComponent(id)}`;
    case "story": return `/stories/${id.split(":").pop()}`;
    default: return null;
  }
}

export const safeHttps = (u: string): string | undefined => (/^https:\/\//i.test(u) ? u : undefined);
