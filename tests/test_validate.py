"""Tests for dataset validation."""
import json, tempfile, os
from pathlib import Path
from atlas.validate import validate_dataset


def _write_dataset(tmp, rows_by_chunk):
    for name, rows in rows_by_chunk.items():
        p = Path(tmp) / name
        p.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    (Path(tmp) / "manifest.json").write_text(
        json.dumps({"sources": [{"name": "fix", "sha": "abc"}]}), encoding="utf-8"
    )


def test_unique_ids_and_endpoints():
    with tempfile.TemporaryDirectory() as tmp:
        rows = {
            "repos.jsonl": [{"id": "repo:fix", "name": "fix"}],
            "commits.jsonl": [{"id": "commit:fix:abc", "repository": "fix", "sha": "abc", "parents": []}],
            "relationships.jsonl": [
                {"source": "repo:fix", "target": "commit:fix:abc", "type": "CONTAINS",
                 "repository": "fix", "evidence_type": "syntactic"},
            ],
        }
        _write_dataset(tmp, rows)
        assert validate_dataset(Path(tmp)) is True


def test_unknown_relationship_endpoint_fails():
    with tempfile.TemporaryDirectory() as tmp:
        rows = {
            "repos.jsonl": [{"id": "repo:fix", "name": "fix"}],
            "relationships.jsonl": [
                {"source": "repo:fix", "target": "commit:fix:missing", "type": "CALLS",
                 "repository": "fix", "evidence_type": "syntactic"},
            ],
        }
        _write_dataset(tmp, rows)
        assert validate_dataset(Path(tmp)) is False


def test_raw_email_fails_privacy():
    with tempfile.TemporaryDirectory() as tmp:
        rows = {
            "contributors.jsonl": [
                {"id": "contributor:fix:user", "repository": "fix", "name": "U", "email_norm": "a@b.com"},
            ],
        }
        _write_dataset(tmp, rows)
        assert validate_dataset(Path(tmp)) is False
