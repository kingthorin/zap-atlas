"""Load human-authored stories from stories/*.json into story rows.

Stories are editorial content, so a malformed file fails the build loudly
instead of being skipped. Reference integrity (commits, entities, documents
exist in the dataset) is checked by ``atlas validate``.
"""

from __future__ import annotations

import json
from pathlib import Path

from atlas.schema import Story, story_id
from dataclasses import asdict

_REQUIRED = ("title", "description", "audience", "status", "chapters")
STATUSES = ("draft", "reviewed")


def load_stories(stories_dir: Path) -> list[dict]:
    rows = []
    for path in sorted(stories_dir.glob("*.json")) if stories_dir.is_dir() else []:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"{path.name}: invalid JSON: {e}") from e
        missing = [k for k in _REQUIRED if k not in raw]
        if missing:
            raise ValueError(f"{path.name}: missing {', '.join(missing)}")
        if raw["status"] not in STATUSES:
            raise ValueError(f"{path.name}: status must be one of {STATUSES}")
        if not raw["chapters"]:
            raise ValueError(f"{path.name}: a story needs at least one chapter")

        def union(key):
            out = []
            for ch in raw["chapters"]:
                for v in ch.get(key, []):
                    if v not in out:
                        out.append(v)
            return out

        story = Story(
            id=story_id(path.stem), title=raw["title"], description=raw["description"],
            audience=raw["audience"], chapters=raw["chapters"],
            entities=union("entities"), commits=union("commits"), documents=union("documents"),
            evidence=sorted({e["url"] for ch in raw["chapters"] for e in ch.get("evidence", [])}),
        )
        row = asdict(story)
        row["status"] = raw["status"]
        rows.append(row)
    return rows
