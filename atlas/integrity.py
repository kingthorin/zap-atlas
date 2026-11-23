"""Deeper dataset checks, run on real datasets (those whose manifest has an inventory).

Hashes and sizes of every chunk, schema version and required fields, pinned source SHAs and
revision references, relative paths, shard indexes against shard files, and story text.
Each check returns a list of error strings.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

from atlas.schema import SCHEMA_VERSION
from atlas.sharding import KINDS, file_path, shard_name

HEX40 = re.compile(r"^[0-9a-f]{40}$")
REQUIRED = {
    "commits": ("id", "repository", "sha", "parents", "committer_date"),
    "modules": ("id", "repository", "path"),
    "addons": ("id", "module", "name"),
    "symbols": ("id", "repository", "file", "qualified_name", "start_line", "end_line"),
    "relationships": ("source", "target", "type", "repository"),
    "milestones": ("id", "repository", "date", "tag", "commits"),
    "docs": ("id", "repository", "path", "title"),
    "stories": ("id", "title", "group", "date", "status", "chapters"),
}
MAX_PER_CHECK = 20


def _capped(errors: list[str], what: str) -> list[str]:
    return errors[:MAX_PER_CHECK] + ([f"... and {len(errors) - MAX_PER_CHECK} more: {what}"] if len(errors) > MAX_PER_CHECK else [])


def check_manifest_files(dataset: Path, manifest: dict) -> list[str]:
    """Every chunk is listed with the right size and SHA-256, and every data file is listed."""
    errors, listed = [], set()
    for entry in manifest.get("inventory", []):
        name = entry["name"]
        listed.add(name)
        path = dataset / name
        if not path.is_file():
            errors.append(f"manifest lists missing file {name}")
            continue
        data = path.read_bytes()
        if len(data) != entry.get("size_bytes"):
            errors.append(f"{name}: size {len(data)} differs from manifest {entry.get('size_bytes')}")
        elif hashlib.sha256(data).hexdigest() != entry.get("sha256"):
            errors.append(f"{name}: sha256 differs from manifest")
    if set(manifest.get("chunks", [])) != listed:
        errors.append("manifest chunks and inventory list different files")
    on_disk = {p.relative_to(dataset).as_posix() for p in dataset.rglob("*") if p.is_file() and not p.name.startswith(".")}
    errors += [f"{n} is not listed in the manifest" for n in sorted(on_disk - listed - {"manifest.json"})]
    return _capped(errors, "manifest files")


def check_schema(manifest: dict, all_rows: dict[str, list[dict]]) -> list[str]:
    errors = []
    if str(manifest.get("schema_version", "")).split(".")[0] != SCHEMA_VERSION.split(".")[0]:
        errors.append(f"schema_version {manifest.get('schema_version')} is not compatible with {SCHEMA_VERSION}")
    for kind, fields in REQUIRED.items():
        bad = [f"{kind} row {r.get('id') or r.get('source')} lacks {f}" for r in all_rows.get(kind, []) for f in fields if f not in r]
        errors += _capped(bad, f"{kind} required fields")
    return errors


def check_revisions(manifest: dict, all_rows: dict[str, list[dict]]) -> list[str]:
    """Source SHAs are full and match repos.jsonl; revisions that rows and file ids cite are the pinned ones."""
    errors, pinned = [], {}
    for src in manifest.get("sources", []):
        if not HEX40.match(src.get("sha") or ""):
            errors.append(f"source {src.get('name')} sha is not a full 40-character SHA: {src.get('sha')}")
        pinned[src["name"]] = src.get("sha")
    for repo in all_rows.get("repos", []):
        if repo.get("sha") != pinned.get(repo.get("name")):
            errors.append(f"repo {repo.get('name')} sha differs from the manifest source")
    bad = []
    for r in all_rows.get("relationships", []):
        rev = r.get("source_revision")
        if rev and rev != pinned.get(r["repository"]):
            bad.append(f"relationship {r['type']} {r['source']} cites revision {rev}, not the pinned {pinned.get(r['repository'])}")
    for s in all_rows.get("symbols", []):
        parts = s["file"].split(":", 3)
        if len(parts) < 4 or parts[2] != pinned.get(s["repository"]):
            bad.append(f"symbol {s['id']} file id does not carry the pinned revision")
    return errors + _capped(bad, "revision references")


def _unsafe(path: str | None) -> bool:
    return bool(path) and (path.startswith("/") or "\\" in path or ".." in path.split("/"))


def check_paths(all_rows: dict[str, list[dict]]) -> list[str]:
    """Paths are repository-relative: no leading slash, backslash or .. segment."""
    bad = []
    for kind in ("modules", "docs"):
        bad += [f"{kind} {r['id']} path {r['path']!r}" for r in all_rows.get(kind, []) if _unsafe(r.get("path"))]
    bad += [f"relationship source_file {r['source_file']!r}" for r in all_rows.get("relationships", []) if _unsafe(r.get("source_file"))]
    bad += [f"symbol {s['id']} file path {file_path(s['file'])!r}" for s in all_rows.get("symbols", []) if _unsafe(file_path(s["file"]))]
    return _capped(bad, "unsafe paths")


def _lines(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def check_shards(dataset: Path) -> list[str]:
    """Shard indexes agree with the shard files: row counts, symbol placement, and incoming edges."""
    errors = []
    for index_path in sorted((dataset / "shards").glob("*.json")):
        repo = index_path.stem
        ix = json.loads(index_path.read_text(encoding="utf-8"))
        keys, placed, relkeys, incoming = ix["keys"], {}, set(), []
        for i, key in enumerate(keys):
            for kind, expected in zip(KINDS, ix["n"][i]):
                path = dataset / kind / repo / f"{shard_name(key)}.jsonl"
                rows = _lines(path) if path.is_file() else []
                if len(rows) != expected:
                    errors.append(f"{kind}/{repo}/{shard_name(key)}: {len(rows)} rows, index says {expected}")
                if kind == "symbols":
                    for s in rows:
                        placed[s["id"].split(":", 2)[2]] = i
                elif kind == "relationships":
                    relkeys.update((r["source"], r["target"], r["type"], r.get("source_line")) for r in rows)
                else:
                    incoming += [(r["source"], r["target"], r["type"], r.get("source_line")) for r in rows]
        if placed != ix["s"]:
            errors.append(f"shards/{repo}.json symbol index differs from the symbol shards "
                          f"({len(ix['s'])} indexed, {len(placed)} in shards)")
        errors += [f"incoming/{repo}: edge {k[0]} -> {k[1]} is in no relationship shard" for k in incoming if k not in relkeys][:MAX_PER_CHECK]
    return errors


QUOTED = re.compile(r'"([^"\n]{12,})"')


def check_stories(all_rows: dict[str, list[dict]]) -> list[str]:
    """Story text has no escape artefacts (a doubled backslash once showed up as \\" on the site) and balanced quotes."""
    errors = []
    for story in all_rows.get("stories", []):
        for ch in story.get("chapters", []):
            text = ch.get("text", "")
            if "\\" in text:
                errors.append(f"story {story['id']} chapter {ch.get('title')!r} contains a backslash")
            if text.count('"') % 2:
                errors.append(f"story {story['id']} chapter {ch.get('title')!r} has an odd number of double quotes")
    return _capped(errors, "story text")


def story_warnings(all_rows: dict[str, list[dict]]) -> list[str]:
    """A commit subject quoted in a chapter should usually be cited. Advisory: a quote may be an example, not a claim."""
    subjects = defaultdict(set)
    for c in all_rows.get("commits", []):
        subjects[c["subject"]].add(c["id"])
    out = []
    for story in all_rows.get("stories", []):
        cited = set(story.get("commits", []))
        for ch in story.get("chapters", []):
            cited |= set(ch.get("commits", []))
        for ch in story.get("chapters", []):
            for q in QUOTED.findall(ch.get("text", "")):
                ids = subjects.get(q.rstrip("."))
                if ids and not ids & cited:
                    out.append(f"story {story['id']} quotes the commit subject {q!r} without citing it")
    return out


def check_integrity(dataset: Path, manifest: dict, all_rows: dict[str, list[dict]]) -> list[str]:
    return (check_manifest_files(dataset, manifest) + check_schema(manifest, all_rows) + check_revisions(manifest, all_rows)
            + check_paths(all_rows) + check_shards(dataset) + check_stories(all_rows))
