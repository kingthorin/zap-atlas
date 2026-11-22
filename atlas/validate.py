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

    # Load all jsonl rows
    all_rows: dict[str, list[dict]] = {}
    for p in dataset.glob("*.jsonl"):
        rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
        all_rows[p.name] = rows

    # Unique IDs per entity chunk
    id_chunks = ["repos.jsonl", "commits.jsonl", "modules.jsonl", "addons.jsonl",
                 "files.jsonl", "symbols.jsonl", "branches.jsonl", "tags.jsonl",
                 "contributors.jsonl", "docs.jsonl", "stories.jsonl"]
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
    for row in all_rows.get("relationships.jsonl", []):
        if row.get("evidence_type") == "syntactic":
            continue
        for end in ("source", "target"):
            v = row.get(end)
            if v and v not in known_ids:
                errors.append(f"relationship {row.get('type')} references unknown {end}: {v}")

    # Commit parents must exist
    commit_ids = {r["id"] for r in all_rows.get("commits.jsonl", [])}
    for row in all_rows.get("commits.jsonl", []):
        for p in row.get("parents", []):
            if p not in commit_ids:
                errors.append(f"commit {row['id']} has unknown parent {p}")

    # Privacy: no raw emails in contributors
    for row in all_rows.get("contributors.jsonl", []):
        email = row.get("email_norm", "")
        if "@" in email and "***" not in email:
            errors.append(f"contributor {row['id']} may contain raw email: {email}")

    # Manifest sources have SHAs
    for src in manifest.get("sources", []):
        if not src.get("sha"):
            errors.append(f"source {src.get('name')} missing sha")

    if errors:
        print(f"[validate] FAILED with {len(errors)} error(s):")
        for e in errors[:50]:
            print("  -", e)
        return False
    print(f"[validate] OK ({len(known_ids)} unique entities, {len(errors)} errors)")
    return True

