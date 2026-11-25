"""Commits and top contributors between consecutive ZAP releases, for the Releases page.

core_release_windows.json maps a core-release milestone id to {"n": commits dated after the previous release's
date up to and including this release's date, "top": [[author name, commits], ...] (at most 3)}. The first release
covers everything before it. Published author names only, never emails; bots and "(no author)" are left out of "top".
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from atlas import jsonfmt

CORE_WINDOWS = "core_release_windows.json"
SKIP = ("(no author)",)


def _bot(name: str) -> bool:
    n = name.lower()
    return n in SKIP or n.endswith("[bot]") or n.endswith("-bot") or n in ("dependabot", "zapbot")


def build_core_windows(milestones: list[dict], commits: list[dict]) -> dict[str, dict]:
    releases = sorted((m for m in milestones if m["kind"] == "core-release"), key=lambda m: m["date"])
    dated = sorted(((c["committer_date"], c["author_name"]) for c in commits if c["repository"] == "zaproxy"))
    out: dict[str, dict] = {}
    i = 0
    for m in releases:
        names: Counter = Counter()
        n = 0
        while i < len(dated) and dated[i][0] <= m["date"]:
            n += 1
            if not _bot(dated[i][1]):
                names[dated[i][1]] += 1
            i += 1
        out[m["id"]] = {"n": n, "top": [[k, v] for k, v in sorted(names.items(), key=lambda kv: (-kv[1], kv[0]))[:3]]}
    return out


def write_core_windows(output_dir: Path, milestones: list[dict], commits: list[dict]) -> str:
    (output_dir / CORE_WINDOWS).write_text(jsonfmt.dumps(build_core_windows(milestones, commits), ensure_ascii=False), encoding="utf-8")
    return CORE_WINDOWS


def rebuild_from_shards(dataset: Path) -> str:
    def rows(pattern: str) -> list[dict]:
        return [json.loads(l) for p in sorted(dataset.glob(pattern)) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    return write_core_windows(dataset, rows("milestones.jsonl"), rows("commits/zaproxy/*.jsonl"))
