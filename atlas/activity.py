"""Activity per module and per file, for the graph: first and last commit, commits and lines changed.

File changes are credited to a file's *current* path: changes are walked from the newest commit to the
oldest, and a rename ``old -> new`` makes the older history of ``old`` belong to whatever ``new`` became.
A path that is added again later starts a new history. Both outputs use that current path, so a module
keeps the history of files that were moved into it.

* module_activity.json: module id -> {"first", "last", "commits", "lines"} (lines = added + deleted). A file belongs to
  the module with the longest path that is a prefix of its current path (the same rule as the shards).
* file_activity.json: repository -> path -> [first, last, commits, lines] for the files that currently declare symbols.
* timeline_modules.json: module id -> "YYYY-MM" -> [commits, distinct authors, lines added, lines deleted], the same shape
  as timeline.json but for one module, for the timeline's focus selector.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ACTIVITY = "module_activity.json"
FILE_ACTIVITY = "file_activity.json"
MODULE_TIMELINE = "timeline_modules.json"


def credited_changes(commits: list[dict], file_changes: list[dict]):
    """Yield (repository, current path, commit id, day, lines added, lines deleted) for every change, following renames."""
    date_of = {c["id"]: c["committer_date"] for c in commits}
    by_commit: dict[str, list[dict]] = defaultdict(list)
    for fc in file_changes:
        if fc.get("commit") in date_of and fc.get("path"):
            by_commit[fc["commit"]].append(fc)
    current: dict[tuple[str, str], str] = {}      # (repository, an older name) -> the file's current path
    for commit in sorted(by_commit, key=lambda c: date_of[c], reverse=True):
        rows = by_commit[commit]
        for fc in rows:
            repo, path = fc["repository"], fc["path"]
            canon = current.get((repo, path), path)
            yield repo, canon, commit, date_of[commit][:10], fc.get("additions") or 0, fc.get("deletions") or 0
        for fc in rows:
            repo = fc["repository"]
            if fc["change_type"] == "R" and fc.get("old_path"):
                current[(repo, fc["old_path"])] = current.get((repo, fc["path"]), fc["path"])
            elif fc["change_type"] == "A":
                current.pop((repo, fc["path"]), None)     # earlier history of this name is another file


def _module_of(paths: dict[str, str], path: str) -> str | None:
    """The module with the longest path that is a prefix of ``path``."""
    parts = path.split("/")
    return next((paths["/".join(parts[:i])] for i in range(len(parts), 0, -1) if "/".join(parts[:i]) in paths), None)


def build_module_timeline(modules: list[dict], commits: list[dict], file_changes: list[dict]) -> dict[str, dict[str, list[int]]]:
    """Per module and month: [commits, distinct authors, lines added, lines deleted], on current paths."""
    by_repo: dict[str, dict[str, str]] = {}
    for m in modules:
        by_repo.setdefault(m["repository"], {})[m["path"]] = m["id"]
    author_of = {c["id"]: c.get("author_name", "") for c in commits}
    seen: dict[tuple[str, str], tuple[set[str], set[str]]] = {}
    out: dict[str, dict[str, list[int]]] = {}
    for repo, path, commit, day, added, deleted in credited_changes(commits, file_changes):
        mid = _module_of(by_repo.get(repo, {}), path)
        if mid is None:
            continue
        month = day[:7]
        row = out.setdefault(mid, {}).setdefault(month, [0, 0, 0, 0])
        ids, names = seen.setdefault((mid, month), (set(), set()))
        if commit not in ids:
            ids.add(commit)
            names.add(author_of.get(commit, ""))
            row[0] += 1
            row[1] = len(names)
        row[2] += added
        row[3] += deleted
    return {mid: dict(sorted(months.items())) for mid, months in sorted(out.items())}


def _add(stats: dict, key, day: str, lines: int, commit: str, touched: dict) -> None:
    s = stats.setdefault(key, {"first": day, "last": day, "commits": 0, "lines": 0})
    s["first"], s["last"] = min(s["first"], day), max(s["last"], day)
    s["lines"] += lines
    touched.setdefault(key, set()).add(commit)


def build_activity(modules: list[dict], commits: list[dict], file_changes: list[dict],
                   current_files: dict[str, set[str]] | None = None) -> tuple[dict[str, dict], dict[str, dict[str, list]]]:
    """(module activity, file activity). ``current_files``: repository -> paths whose activity is wanted per file."""
    by_repo: dict[str, dict[str, str]] = {}
    for m in modules:
        by_repo.setdefault(m["repository"], {})[m["path"]] = m["id"]
    mod_stats: dict[str, dict] = {}
    file_stats: dict[tuple[str, str], dict] = {}
    mod_touched: dict[str, set[str]] = {}
    file_touched: dict[tuple[str, str], set[str]] = {}
    for repo, path, commit, day, added, deleted in credited_changes(commits, file_changes):
        lines = added + deleted
        mid = _module_of(by_repo.get(repo, {}), path)
        if mid is not None:
            _add(mod_stats, mid, day, lines, commit, mod_touched)
        if current_files and path in current_files.get(repo, ()):
            _add(file_stats, (repo, path), day, lines, commit, file_touched)
    for mid, ids in mod_touched.items():
        mod_stats[mid]["commits"] = len(ids)
    files: dict[str, dict[str, list]] = {}
    for (repo, path), s in sorted(file_stats.items()):
        files.setdefault(repo, {})[path] = [s["first"], s["last"], len(file_touched[(repo, path)]), s["lines"]]
    return dict(sorted(mod_stats.items())), files


def write_activity(output_dir: Path, modules: list[dict], commits: list[dict], file_changes: list[dict], symbols: list[dict] | None = None) -> list[str]:
    current: dict[str, set[str]] = defaultdict(set)
    for s in symbols or []:
        current[s["repository"]].add(s["file"].split(":", 3)[3])
    mods, files = build_activity(modules, commits, file_changes, current)
    (output_dir / ACTIVITY).write_text(json.dumps(mods, separators=(",", ":")), encoding="utf-8")
    (output_dir / FILE_ACTIVITY).write_text(json.dumps(files, separators=(",", ":")), encoding="utf-8")
    (output_dir / MODULE_TIMELINE).write_text(json.dumps(build_module_timeline(modules, commits, file_changes), separators=(",", ":")), encoding="utf-8")
    return [ACTIVITY, FILE_ACTIVITY, MODULE_TIMELINE]


def rebuild_from_shards(dataset: Path) -> list[str]:
    """Recompute both files from the commit, file and symbol shards of an existing dataset."""
    def rows(pattern: str) -> list[dict]:
        return [json.loads(l) for p in sorted(dataset.glob(pattern)) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    return write_activity(dataset, rows("modules.jsonl"), rows("commits/*/*.jsonl"), rows("files/*/*.jsonl"), rows("symbols/*/*.jsonl"))
