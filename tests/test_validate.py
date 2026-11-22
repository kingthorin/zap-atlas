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
                 "repository": "fix", "evidence_type": "resolved"},
            ],
        }
        _write_dataset(tmp, rows)
        assert validate_dataset(Path(tmp)) is False


def test_unresolved_syntactic_relationship_endpoint_allowed():
    with tempfile.TemporaryDirectory() as tmp:
        rows = {
            "repos.jsonl": [{"id": "repo:fix", "name": "fix"}],
            "relationships.jsonl": [
                {"source": "repo:fix", "target": "symbol:fix:external", "type": "CALLS",
                 "repository": "fix", "evidence_type": "syntactic"},
            ],
        }
        _write_dataset(tmp, rows)
        assert validate_dataset(Path(tmp)) is True


def test_raw_email_fails_privacy():
    with tempfile.TemporaryDirectory() as tmp:
        rows = {
            "contributors.jsonl": [
                {"id": "contributor:fix:user", "repository": "fix", "name": "U", "email_norm": "a@b.com"},
            ],
        }
        _write_dataset(tmp, rows)
        assert validate_dataset(Path(tmp)) is False


def test_sharded_chunks_are_merged(tmp_path):
    (tmp_path / "commits" / "fix").mkdir(parents=True)
    (tmp_path / "commits/fix/2023.jsonl").write_text(
        json.dumps({"id": "commit:fix:b", "repository": "fix", "parents": ["commit:fix:a"]}) + "\n")
    (tmp_path / "commits/fix/2022.jsonl").write_text(
        json.dumps({"id": "commit:fix:a", "repository": "fix", "parents": []}) + "\n")
    _write_dataset(tmp_path, {})
    assert validate_dataset(tmp_path) is True
    (tmp_path / "commits/fix/2022.jsonl").unlink()
    assert validate_dataset(tmp_path) is False  # parent now missing


def test_email_in_commit_fields_fails_privacy(tmp_path):
    for field in ("author_name", "subject", "message"):
        row = {"id": "commit:fix:a", "repository": "fix", "parents": [],
               "author_name": "x", "subject": "s", "message": "m"}
        row[field] = "Signed-off-by: A <a@b.com>"
        (tmp_path / "commits.jsonl").write_text(json.dumps(row) + "\n")
        _write_dataset(tmp_path, {})
        assert validate_dataset(tmp_path) is False, field
