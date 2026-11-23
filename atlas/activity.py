"""Per-module activity for the graph: first and last commit, commit count and lines changed.

module_activity.json maps module id -> {"first": "YYYY-MM-DD", "last": "YYYY-MM-DD", "commits": n, "lines": added + deleted}.
A file change counts for the module with the longest path that is a prefix of the file's path (the same rule as
the shards). Renamed files count under their new path, and merge commits have no file changes.
"""
from __future__ import annotations

import json
from pathlib import Path

ACTIVITY = "module_activity.json"


def build_activity(modules: list[dict], commits: list[dict], file_changes: list[dict]) -> dict[str, dict]:
    date_of = {c["id"]: c["committer_date"][:10] for c in commits}
    by_repo: dict[str, dict[str, str]] = {}
    for m in modules:
        by_repo.setdefault(m["repository"], {})[m["path"]] = m["id"]
    stats: dict[str, dict] = {}
    touched: dict[str, set[str]] = {}
    for fc in file_changes:
        paths = by_repo.get(fc.get("repository"), {})
        parts = (fc.get("path") or "").split("/")
        mid = next((paths["/".join(parts[:i])] for i in range(len(parts), 0, -1) if "/".join(parts[:i]) in paths), None)
        day = date_of.get(fc.get("commit"))
        if mid is None or day is None:
            continue
        s = stats.setdefault(mid, {"first": day, "last": day, "commits": 0, "lines": 0})
        s["first"], s["last"] = min(s["first"], day), max(s["last"], day)
        s["lines"] += (fc.get("additions") or 0) + (fc.get("deletions") or 0)
        touched.setdefault(mid, set()).add(fc["commit"])
    for mid, commit_ids in touched.items():
        stats[mid]["commits"] = len(commit_ids)
    return dict(sorted(stats.items()))


def write_activity(output_dir: Path, modules: list[dict], commits: list[dict], file_changes: list[dict]) -> str:
    (output_dir / ACTIVITY).write_text(json.dumps(build_activity(modules, commits, file_changes), separators=(",", ":")), encoding="utf-8")
    return ACTIVITY


def rebuild_from_shards(dataset: Path) -> str:
    """Recompute module_activity.json from the commit and file shards of an existing dataset."""
    def rows(pattern: str) -> list[dict]:
        return [json.loads(l) for p in sorted(dataset.glob(pattern)) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    return write_activity(dataset, rows("modules.jsonl"), rows("commits/*/*.jsonl"), rows("files/*/*.jsonl"))
