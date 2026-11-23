"""Monthly activity per repository, for the zoomable timeline.

timeline.json maps repository -> "YYYY-MM" -> [commits, distinct authors]. Months are by committer
date, the same basis as the per-year commit shards. Author counts use the published author names,
never emails. Line counts are not included: the generator does not collect them yet.
"""
from __future__ import annotations

import json
from pathlib import Path

TIMELINE = "timeline.json"


def build_timeline(commits: list[dict]) -> dict[str, dict[str, list[int]]]:
    counts: dict[str, dict[str, int]] = {}
    authors: dict[tuple[str, str], set[str]] = {}
    for c in commits:
        month = c["committer_date"][:7]
        counts.setdefault(c["repository"], {})[month] = counts.get(c["repository"], {}).get(month, 0) + 1
        authors.setdefault((c["repository"], month), set()).add(c["author_name"])
    return {r: {m: [n, len(authors[(r, m)])] for m, n in sorted(months.items())} for r, months in sorted(counts.items())}


def write_timeline(output_dir: Path, commits: list[dict]) -> str:
    (output_dir / TIMELINE).write_text(json.dumps(build_timeline(commits), separators=(",", ":")), encoding="utf-8")
    return TIMELINE


def rebuild_from_shards(dataset: Path) -> str:
    """Recompute timeline.json from the commits/ year shards of an existing dataset."""
    commits: list[dict] = []
    for p in sorted((dataset / "commits").glob("*/*.jsonl")):
        commits += [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    return write_timeline(dataset, commits)
