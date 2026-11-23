"""``atlas inspect``: print one entity of a generated dataset with its edges and what cites it.

Lookups use the dataset's own layout (small chunks, per-repository shard indexes, year shards for
commits) and read only the files an entity can live in. Edges of non-symbol entities are found by a
substring prefilter over the repository's relationship shards before any JSON is parsed.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from atlas.sharding import KINDS, shard_name

SMALL = {"repo": "repos", "module": "modules", "addon": "addons", "doc": "docs", "milestone": "milestones",
         "story": "stories", "tag": "tags", "branch": "branches", "contributor": "contributors"}
HIDE = {"message", "headings", "anchors", "dependencies", "commits", "chapters", "parents"}  # shown separately or too long
EDGE_SECTIONS = (("outgoing", "source", "target"), ("incoming", "target", "source"))


def _lines(path: Path):
    if path.is_file():
        with path.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    yield line


def _rows(path: Path):
    for line in _lines(path):
        yield json.loads(line)


def _find(path: Path, entity_id: str) -> dict | None:
    needle = f'"{entity_id}"'
    for line in _lines(path):
        if needle in line:
            row = json.loads(line)
            if row.get("id") == entity_id:
                return row
    return None


def _kind(entity_id: str) -> str:
    return entity_id.split(":", 1)[0]


def suggestions(dataset: Path, text: str, limit: int = 5) -> list[str]:
    """Ids of the small chunks that contain ``text``, for a "did you mean" message."""
    low, out = text.lower(), []
    for name in SMALL.values():
        for row in _rows(dataset / f"{name}.jsonl"):
            if low in row["id"].lower():
                out.append(row["id"])
                if len(out) >= limit:
                    return out
    return out


def resolve(dataset: Path, text: str) -> str:
    """A full id, or a bare name that is an add-on, as in ``oast`` for ``addon:oast``."""
    if ":" not in text:
        text = f"addon:{text}"
    return text


def find_entity(dataset: Path, entity_id: str) -> tuple[dict | None, str]:
    """(row, where it was found)."""
    kind = _kind(entity_id)
    if kind in SMALL:
        name = f"{SMALL[kind]}.jsonl"
        return _find(dataset / name, entity_id), name
    parts = entity_id.split(":", 2)
    if len(parts) < 3:
        return None, ""
    repo = parts[1]
    if kind == "commit":
        for path in sorted((dataset / "commits" / repo).glob("*.jsonl"), reverse=True):
            for row in _rows(path):
                if row["id"] == entity_id or (len(parts[2]) >= 7 and row["sha"].startswith(parts[2])):
                    return row, f"commits/{repo}/{path.name}"
        return None, ""
    if kind == "symbol":
        index = dataset / "shards" / f"{repo}.json"
        if not index.is_file():
            return None, ""
        ix = json.loads(index.read_text(encoding="utf-8"))
        at = ix["s"].get(parts[2])
        if at is None:
            return None, ""
        name = f"symbols/{repo}/{shard_name(ix['keys'][at])}.jsonl"
        return _find(dataset / name, entity_id), name
    return None, ""


def _edges(dataset: Path, entity_id: str, row_where: str) -> list[dict]:
    """Every relationship with this entity at either end (symbols read their own shard files only)."""
    repo = entity_id.split(":", 2)[1] if entity_id.count(":") >= 2 else ""
    needle = f'"{entity_id}"'
    if _kind(entity_id) == "symbol":
        shard = Path(row_where).stem
        paths = [dataset / k / repo / f"{shard}.jsonl" for k in ("relationships", "incoming")]
    else:
        repos = [p.name for p in sorted((dataset / "relationships").glob("*")) if p.is_dir()]
        paths = [p for r in repos for p in sorted((dataset / "relationships" / r).glob("*.jsonl"))]
    seen, out = set(), []
    for path in paths:
        for line in _lines(path):
            if needle not in line:
                continue
            r = json.loads(line)
            key = (r["source"], r["target"], r["type"], r.get("source_line"))
            if (r["source"] == entity_id or r["target"] == entity_id) and key not in seen:
                seen.add(key)
                out.append(r)
    return out


def _cited_by(dataset: Path, entity_id: str) -> list[str]:
    out = []
    for story in _rows(dataset / "stories.jsonl"):
        refs = set()
        for holder in [story] + story.get("chapters", []):
            for k in ("entities", "commits", "documents", "milestones"):
                refs.update(holder.get(k, []))
        if entity_id in refs:
            out.append(f"{story['id']}  {story['title']}")
    return out


def _label(entity_id: str) -> str:
    """An id without its kind and repository prefix; file ids show just the path."""
    if entity_id.startswith("file:"):
        return entity_id.split(":", 3)[3]
    return entity_id.split(":", 2)[2] if entity_id.count(":") >= 2 else entity_id


def _short(value, width: int = 140) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= width else text[:width - 1] + "…"


def _enrich(dataset: Path, entity_id: str, row: dict) -> list[str]:
    kind, lines = _kind(entity_id), []
    if kind == "addon":
        lines.append(f"depends on ({len(row.get('dependencies', []))}): {', '.join(d.removeprefix('addon:') for d in row.get('dependencies', [])) or '-'}")
        required = sorted(a["id"].removeprefix("addon:") for a in _rows(dataset / "addons.jsonl") if entity_id in a.get("dependencies", []))
        lines.append(f"required by ({len(required)}): {', '.join(required) or '-'}")
        rel = [m for m in _rows(dataset / "milestones.jsonl") if m.get("addon") == entity_id]
        if rel:
            lines.append(f"releases: {len(rel)}, latest {max(rel, key=lambda m: m['date'])['title']} ({max(m['date'] for m in rel)[:10]})")
    elif kind == "module":
        langs = defaultdict(int)
        for r in _rows(dataset / "languages.jsonl"):
            if r["module"] == row["path"] and r["repository"] == row["repository"]:
                langs[r["language"]] += r["lines"]
        if langs:
            lines.append("lines: " + ", ".join(f"{k} {v:,}" for k, v in sorted(langs.items(), key=lambda kv: -kv[1])[:5]))
        graph = json.loads((dataset / "module_graph.json").read_text(encoding="utf-8")) if (dataset / "module_graph.json").is_file() else None
        if graph and entity_id in graph["nodes"]:
            at, totals = graph["nodes"].index(entity_id), defaultdict(int)
            for s, t, _, n in graph["edges"]:
                if at in (s, t):
                    totals[graph["nodes"][t if s == at else s]] += n
            top = sorted(totals.items(), key=lambda kv: -kv[1])[:5]
            lines.append(f"most linked modules ({len(totals)} in all): " + ", ".join(f"{m.split(':', 2)[2]} {n:,}" for m, n in top))
    elif kind == "commit":
        lines.append(f"parents: {', '.join(p.split(':', 2)[2][:10] for p in row.get('parents', [])) or 'none (root)'}")
        pointing = [m["title"] for m in _rows(dataset / "milestones.jsonl") if entity_id in m.get("commits", [])]
        if pointing:
            lines.append(f"tagged as: {', '.join(pointing)}")
    elif kind == "story":
        lines.append(f"chapters: {len(row.get('chapters', []))}; " + "; ".join(c["title"] for c in row.get("chapters", [])[:6]))
    elif kind == "doc":
        lines.append(f"recent commits recorded: {len(row.get('commits', []))}")
    return lines


def inspect_entity(dataset: Path, entity_id: str, limit: int = 10) -> str | None:
    """The report for one entity, or None when it is not in the dataset."""
    row, where = find_entity(dataset, entity_id)
    if row is None:
        return None
    out = [f"{entity_id}  ({_kind(entity_id)})", f"found in {where}"]
    for key, value in row.items():
        if key != "id" and key not in HIDE and value not in (None, "", [], {}):
            out.append(f"  {key}: {_short(value)}")
    if "message" in row and row["message"] != row.get("subject"):
        out.append(f"  message: {_short(row['message'].split(chr(10), 1)[-1].strip() or row['message'], 200)}")
    out += [f"  {line}" for line in _enrich(dataset, entity_id, row)]

    edges = _edges(dataset, entity_id, where)
    for label, near, far in EDGE_SECTIONS:
        mine = [e for e in edges if e[near] == entity_id]
        if not mine:
            continue
        out.append(f"{label} edges ({len(mine)})")
        by_type = defaultdict(list)
        for e in mine:
            by_type[e["type"]].append(e)
        for t, rows in sorted(by_type.items(), key=lambda kv: -len(kv[1])):
            levels = defaultdict(int)
            for e in rows:
                levels[e.get("evidence_type", "?")] += 1
            out.append(f"  {t} ({len(rows)}; " + ", ".join(f"{n} {k}" for k, n in sorted(levels.items())) + ")")
            others = sorted({e[far] for e in rows})
            out += [f"    {_label(o)}" for o in others[:limit]]
            if len(others) > limit:
                out.append(f"    … and {len(others) - limit} more (use --limit)")
    cited = _cited_by(dataset, entity_id)
    if cited:
        out.append(f"cited by {len(cited)} {'story' if len(cited) == 1 else 'stories'}")
        out += [f"  {c}" for c in cited]
    return "\n".join(out)
