"""Monthly activity per repository, for the zoomable timeline.

timeline.json maps repository -> "YYYY-MM" -> [commits, distinct authors, lines added, lines deleted]. Months are by committer
date, the same basis as the per-year commit shards. Author counts use the published author names,
never emails.
"""
from __future__ import annotations

from atlas import jsonfmt

import json
from pathlib import Path

TIMELINE = "timeline.json"


def build_timeline(commits: list[dict]) -> dict[str, dict[str, list[int]]]:
    counts: dict[str, dict[str, list[int]]] = {}
    authors: dict[tuple[str, str], set[str]] = {}
    for c in commits:
        month = c["committer_date"][:7]
        row = counts.setdefault(c["repository"], {}).setdefault(month, [0, 0, 0, 0])
        row[0] += 1
        row[2] += c.get("additions", 0)
        row[3] += c.get("deletions", 0)
        authors.setdefault((c["repository"], month), set()).add(c["author_name"])
    for (repo, month), names in authors.items():
        counts[repo][month][1] = len(names)
    return {r: dict(sorted(months.items())) for r, months in sorted(counts.items())}


def write_timeline(output_dir: Path, commits: list[dict]) -> str:
    (output_dir / TIMELINE).write_text(jsonfmt.dumps(build_timeline(commits)), encoding="utf-8")
    return TIMELINE


def rebuild_from_shards(dataset: Path) -> str:
    """Recompute timeline.json from the commits/ year shards of an existing dataset."""
    commits: list[dict] = []
    for p in sorted((dataset / "commits").glob("*/*.jsonl")):
        commits += [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    return write_timeline(dataset, commits)
