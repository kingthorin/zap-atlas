"""Load human-authored stories from stories/*.json into story rows.

Stories are editorial content, so a malformed file fails the build loudly
instead of being skipped. Reference integrity (commits, entities, documents
exist in the dataset) is checked by ``atlas validate``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from atlas.schema import Story, story_id
from dataclasses import asdict

_REQUIRED = ("title", "description", "group", "date", "status", "chapters")
STATUSES = ("draft", "reviewed")
GROUPS = ("projects", "features", "history")
MAX_NARRATIVE = 2500  # about 400 words: a short piece, not a second set of chapters
_DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")  # YYYY, YYYY-MM or YYYY-MM-DD


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
        if raw["group"] not in GROUPS:
            raise ValueError(f"{path.name}: group must be one of {GROUPS}")
        if not _DATE.match(str(raw["date"])):
            raise ValueError(f"{path.name}: date must be YYYY, YYYY-MM or YYYY-MM-DD")
        if not raw["chapters"]:
            raise ValueError(f"{path.name}: a story needs at least one chapter")

        narrative = raw.get("narrative")
        if narrative is not None and (not isinstance(narrative, str) or not narrative.strip() or len(narrative) > MAX_NARRATIVE):
            raise ValueError(f"{path.name}: narrative must be a non-empty string of at most {MAX_NARRATIVE} characters")

        sources = raw.get("narrative_sources")
        if sources is not None:
            if not narrative:
                raise ValueError(f"{path.name}: narrative_sources needs a narrative")
            if not isinstance(sources, list) or not sources:
                raise ValueError(f"{path.name}: narrative_sources must be a non-empty list")
            for src in sources:
                if not isinstance(src, dict) or not str(src.get("label", "")).strip() or not str(src.get("url", "")).startswith("https://"):
                    raise ValueError(f"{path.name}: narrative_sources: each entry needs a label and an https url")

        def union(key):
            out = []
            for ch in raw["chapters"]:
                for v in ch.get(key, []):
                    if v not in out:
                        out.append(v)
            return out

        story = Story(
            id=story_id(path.stem), title=raw["title"], description=raw["description"],
            chapters=raw["chapters"],
            entities=union("entities"), commits=union("commits"), documents=union("documents"), milestones=union("milestones"),
            evidence=sorted({e["url"] for ch in raw["chapters"] for e in ch.get("evidence", [])}),
        )
        row = asdict(story)
        if narrative:
            row["narrative"] = narrative.strip()
            row["narrative_sources"] = [{"label": x["label"].strip(), "url": x["url"]} for x in sources or []]
        row["status"] = raw["status"]
        row["group"], row["date"] = raw["group"], str(raw["date"])
        rows.append(row)
    return rows
