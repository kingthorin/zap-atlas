"""``atlas history``: a repository's commit history from a generated dataset.

Without filters it prints the whole history: totals, commits per year, busiest months, top authors,
releases and the newest commits. ``--year`` and ``--since`` restrict that report to a period, and
``--path`` prints the commits that touched a file or directory, following renames of a file back
through its earlier names. Authors are the published author names, never emails. Line counts are not
shown because the dataset does not record them.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

BAR = 30


def _rows(path: Path):
    if path.is_file():
        with path.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)


def _years(dataset: Path, repo: str) -> list[str]:
    return sorted(p.stem for p in (dataset / "commits" / repo).glob("*.jsonl"))


def load_commits(dataset: Path, repo: str, since: str = "", until: str = "") -> list[dict]:
    """Commits of one repository, newest first, with committer date in [since, until) (YYYY-MM-DD, either may be empty)."""
    out = []
    for year in _years(dataset, repo):
        if (since and year < since[:4]) or (until and year > until[:4]):
            continue
        out += [c for c in _rows(dataset / "commits" / repo / f"{year}.jsonl")
                if (not since or c["committer_date"][:10] >= since) and (not until or c["committer_date"][:10] < until)]
    return sorted(out, key=lambda c: c["committer_date"], reverse=True)


def _bar(n: int, top: int) -> str:
    return "█" * max(1, round(BAR * n / top)) if n else ""


def _commit_line(c: dict) -> str:
    return f"{c['committer_date'][:10]}  {c['sha'][:10]}  {c['subject'][:100]}"


def overview(dataset: Path, repo: str, since: str = "", until: str = "", limit: int = 10, label: str = "") -> str | None:
    """The report, or None when the repository has no commits in the dataset."""
    commits = load_commits(dataset, repo, since, until)
    if not commits:
        return None
    repos = {r["name"]: r for r in _rows(dataset / "repos.jsonl")}
    r = repos.get(repo, {})
    whole = not since and not until
    period = "" if whole else f" {label or 'from ' + since}"
    authors = Counter(c["author_name"] for c in commits)
    merges = sum(len(c["parents"]) > 1 for c in commits)
    first, last = commits[-1]["committer_date"][:10], commits[0]["committer_date"][:10]
    out = [f"{repo}  {r.get('url', '')}  @ {r.get('sha', '')[:10]} ({r.get('default_branch', '?')})",
           f"{len(commits):,} commits{period} · {first} to {last} · {len(authors):,} authors · {merges:,} merges ({100 * merges / len(commits):.1f}%)", ""]
    by_year = Counter(c["committer_date"][:4] for c in commits)
    if whole or len(by_year) > 1:
        out.append("Commits by year")
        top = max(by_year.values())
        out += [f"  {y}  {by_year[y]:>6,}  {_bar(by_year[y], top)}" for y in sorted(by_year)]
        out.append("")
    by_month = Counter(c["committer_date"][:7] for c in commits)
    out.append("Busiest months: " + ", ".join(f"{m} ({n:,})" for m, n in by_month.most_common(5)))
    out.append("")
    out.append(f"Top authors (of {len(authors):,})")
    out += [f"  {n:>6,}  {100 * n / len(commits):4.1f}%  {a}" for a, n in authors.most_common(limit)]
    out.append("")
    releases = [m for m in _rows(dataset / "milestones.jsonl") if m["repository"] == repo
                and (not since or m["date"][:10] >= since) and (not until or m["date"][:10] < until)]
    if releases:
        kinds = Counter(m["kind"] for m in releases)
        out.append("Releases: " + ", ".join(f"{n:,} {k}" for k, n in kinds.most_common()))
        out += [f"  {m['date'][:10]}  {m['title']}" for m in sorted(releases, key=lambda m: m["date"], reverse=True)[:limit]]
        if len(releases) > limit:
            out.append(f"  … and {len(releases) - limit:,} more (see the Releases page)")
        out.append("")
    out.append(f"Newest commits")
    out += [f"  {_commit_line(c)}" for c in commits[:limit]]
    return "\n".join(out)


def file_history(dataset: Path, repo: str, path: str, since: str = "", until: str = "", limit: int = 15) -> str | None:
    """Commits that touched a file or directory. A file's earlier names are followed through renames."""
    path = path.strip("/")
    names = {path}                       # names the file had, discovered newest to oldest
    hits: list[tuple[str, str, str, str]] = []   # (commit id, change type, path at the time, old path)
    for year in sorted(_years(dataset, repo), reverse=True):
        rows = sorted(_rows(dataset / "files" / repo / f"{year}.jsonl"), key=lambda r: r["id"])
        # commits of the year, newest first, so renames are seen before the older names they replace
        order = {c["id"]: i for i, c in enumerate(load_commits(dataset, repo, f"{year}-01-01", f"{int(year) + 1}-01-01"))}
        for r in sorted(rows, key=lambda r: order.get(r["commit"], 10**9)):
            p = r["path"]
            if p in names or p.startswith(path + "/"):
                hits.append((r["commit"], r["change_type"], p, r.get("old_path") or ""))
                if r.get("old_path") and p in names:
                    names.add(r["old_path"])
    if not hits:
        return None
    commits = {c["id"]: c for c in load_commits(dataset, repo)}
    shown = [(commits[c], t, p, o) for c, t, p, o in hits if c in commits
             and (not since or commits[c]["committer_date"][:10] >= since) and (not until or commits[c]["committer_date"][:10] < until)]
    shown.sort(key=lambda h: h[0]["committer_date"], reverse=True)
    if not shown:
        return None
    out = [f"History of {path}  ({repo})",
           f"{len(shown):,} changes in {len({h[0]['id'] for h in shown}):,} commits · {shown[-1][0]['committer_date'][:10]} to {shown[0][0]['committer_date'][:10]}"]
    earlier = sorted(names - {path})
    if earlier:
        out.append("earlier names: " + ", ".join(earlier))
    out.append("")
    for c, t, p, o in shown[:limit]:
        note = f"  (renamed from {o})" if t.startswith("R") and o else ""
        out.append(f"  {c['committer_date'][:10]}  {c['sha'][:10]}  {t[0]}  {c['subject'][:90]}{note}")
    if len(shown) > limit:
        out.append(f"  … and {len(shown) - limit:,} more (use --limit)")
    return "\n".join(out)


def history(dataset: Path, repo: str, year: str = "", since: str = "", path: str = "", limit: int = 10) -> str | None:
    until, label = "", f"since {since}"
    if year:
        since, until, label = f"{year}-01-01", f"{int(year) + 1}-01-01", f"in {year}"
    if path:
        return file_history(dataset, repo, path, since, until, limit)
    return overview(dataset, repo, since, until, limit, label)
