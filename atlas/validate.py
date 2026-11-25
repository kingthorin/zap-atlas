"""Validation of generated Atlas datasets.

Checks: unique IDs, relationship endpoints, commit parents, paths, source
revision references, manifest hashes, schema compatibility, privacy rules
(no raw emails), exact-revision GitHub links.
"""

from __future__ import annotations

import json
from pathlib import Path


def validate_dataset(dataset: Path) -> bool:
    manifest_path = dataset / "manifest.json"
    errors = []
    if not manifest_path.is_file():
        print("[validate] ERROR: manifest.json missing")
        return False
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    # Load all jsonl rows. Sharded chunks (commits/<repo>/<year>.jsonl) are merged
    # by kind, the first path segment without its extension.
    all_rows: dict[str, list[dict]] = {}
    for p in sorted(dataset.rglob("*.jsonl")):
        kind = p.relative_to(dataset).parts[0].removesuffix(".jsonl")
        rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
        all_rows.setdefault(kind, []).extend(rows)

    # Unique IDs per entity chunk
    id_chunks = ["repos", "commits", "modules", "addons", "files", "symbols",
                 "branches", "tags", "contributors", "docs", "stories", "languages", "milestones"]
    seen_ids = set()
    for chunk in id_chunks:
        for row in all_rows.get(chunk, []):
            rid = row.get("id")
            if rid:
                if rid in seen_ids:
                    errors.append(f"duplicate id {rid} in {chunk}")
                seen_ids.add(rid)

    # Relationship endpoints must reference known ids
    known_ids = set(seen_ids)
    # Syntactic (unresolved) edges may point at external types, bare method names,
    # or entities not emitted yet, so only non-syntactic edges are checked.
    for row in all_rows.get("relationships", []):
        if row.get("evidence_type") == "syntactic":
            continue
        for end in ("source", "target"):
            v = row.get(end)
            if v and v not in known_ids:
                errors.append(f"relationship {row.get('type')} references unknown {end}: {v}")

    # Stories: every reference must exist in the dataset; evidence links must be https.
    for story in all_rows.get("stories", []):
        refs = [(k, v) for k in ("entities", "commits", "documents", "milestones") for v in story.get(k, [])]
        for ch in story.get("chapters", []):
            refs += [(k, v) for k in ("entities", "commits", "documents", "milestones") for v in ch.get(k, [])]
            for ev in ch.get("evidence", []):
                if not str(ev.get("url", "")).startswith("https://"):
                    errors.append(f"story {story['id']} has non-https evidence url: {ev.get('url')}")
        for kind, ref in refs:
            if ref not in known_ids:
                errors.append(f"story {story['id']} references unknown {kind[:-1]}: {ref}")

    # Commit parents must exist
    commit_ids = {r["id"] for r in all_rows.get("commits", [])}
    for row in all_rows.get("commits", []):
        for p in row.get("parents", []):
            if p not in commit_ids:
                errors.append(f"commit {row['id']} has unknown parent {p}")

    # Milestones: the commit they point at must exist.
    for ms in all_rows.get("milestones", []):
        for c in ms.get("commits", []):
            if c not in commit_ids:
                errors.append(f"milestone {ms['id']} references unknown commit {c}")

    # Help pages: recorded commits must exist.
    for doc in all_rows.get("docs", []):
        for c in doc.get("commits", []):
            if c not in commit_ids:
                errors.append(f"doc {doc['id']} references unknown commit {c}")

    # Privacy: no email-shaped text in any published commit/contributor field.
    from atlas.git_history import EMAIL_RE
    for kind, fields in (("commits", ("author_name", "subject", "message")),
                         ("contributors", ("name", "email_norm"))):
        for row in all_rows.get(kind, []):
            for f in fields:
                if EMAIL_RE.search(row.get(f) or "") or (f == "email_norm" and "@" in (row.get(f) or "")):
                    errors.append(f"{kind[:-1]} {row.get('id')} has email-like text in {f}")

    # Manifest sources have SHAs
    for src in manifest.get("sources", []):
        if not src.get("sha"):
            errors.append(f"source {src.get('name')} missing sha")

    # Deeper checks apply to real datasets, which record an inventory of their files.
    if "inventory" in manifest:
        from atlas.integrity import check_integrity, story_warnings
        errors += check_integrity(dataset, manifest, all_rows)
        for w in story_warnings(all_rows):
            print(f"[validate] warning: {w}")

    if errors:
        print(f"[validate] FAILED with {len(errors)} error(s):")
        for e in errors[:50]:
            print("  -", e)
        return False
    print(f"[validate] OK ({len(known_ids)} unique entities, {len(errors)} errors)")
    return True



def check_contract(dataset: Path) -> list[str]:
    """Files the frontend fetches by name; a missing one only shows up as a broken page."""
    problems = []
    need = ["repos.jsonl", "modules.jsonl", "addons.jsonl", "docs.jsonl", "stories.jsonl", "languages.jsonl", "milestones.jsonl",
            "history_index.json", "timeline.json", "module_graph.json", "module_activity.json", "file_activity.json", "timeline_modules.json", "timeline_sections.json", "core_team.json", "core_release_windows.json", "search/ecosystem.json", "search/symbols.json", "search/commits.json"]
    repos = [json.loads(l)["name"] for l in (dataset / "repos.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()] \
        if (dataset / "repos.jsonl").is_file() else []
    for r in repos:
        index = dataset / "shards" / f"{r}.json"
        need.append(f"shards/{r}.json")
        if index.is_file():
            ix = json.loads(index.read_text(encoding="utf-8"))
            from atlas.sharding import KINDS, shard_name
            need += [f"{k}/{r}/{shard_name(key)}.jsonl" for key, counts in zip(ix["keys"], ix["n"])
                     for k, n in zip(KINDS, counts) if n]
    if (dataset / "history_index.json").is_file():
        idx = json.loads((dataset / "history_index.json").read_text(encoding="utf-8"))
        need += [f"{k}/{r}/{y}.jsonl" for r, years in idx.items() for y, counts in years.items() for k in counts]
        need += [f"commits/{r}/{y}.jsonl" for r, years in idx.items() for y in years]
    problems += [f"missing {n}" for n in sorted(set(need)) if not (dataset / n).is_file()]
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    problems += [f"manifest lists missing chunk {c}" for c in manifest.get("chunks", []) if not (dataset / c).is_file()]
    return problems
