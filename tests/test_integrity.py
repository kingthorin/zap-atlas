"""Deeper dataset checks: hashes, schema, revisions, paths, shards, story text."""
import hashlib
import json
from pathlib import Path

import pytest

from atlas.integrity import story_warnings
from atlas.schema import SCHEMA_VERSION
from atlas.sharding import write_module_shards
from atlas.validate import validate_dataset

SHA = "a" * 40


def _jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def _manifest(root: Path) -> None:
    names = sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and p.name != "manifest.json")
    inventory = [{"name": n, "items": 0, "size_bytes": (root / n).stat().st_size,
                  "sha256": hashlib.sha256((root / n).read_bytes()).hexdigest()} for n in names]
    (root / "manifest.json").write_text(json.dumps({
        "schema_version": SCHEMA_VERSION, "sources": [{"name": "r", "sha": SHA}], "inventory": inventory, "chunks": names}))


@pytest.fixture
def ds(tmp_path):
    """A small valid dataset: one repo, one module, two symbols, a call between them, one story."""
    _jsonl(tmp_path / "repos.jsonl", [{"id": "repo:r", "name": "r", "sha": SHA}])
    _jsonl(tmp_path / "modules.jsonl", [{"id": "module:r:m", "repository": "r", "path": "m"}])
    _jsonl(tmp_path / "commits/r/2024.jsonl", [{"id": "commit:r:c1", "repository": "r", "sha": "c1", "parents": [],
                                                 "committer_date": "2024-01-01T00:00:00Z", "subject": "Fix the widget thing"}])
    syms = [{"id": f"symbol:r:p.{n}", "repository": "r", "file": f"file:r:{SHA}:m/src/{n}.java", "qualified_name": f"p.{n}",
             "start_line": 1, "end_line": 5} for n in "AB"]
    rels = [{"source": "symbol:r:p.A", "target": "symbol:r:p.B", "type": "CALLS", "repository": "r",
             "source_revision": SHA, "source_file": "m/src/A.java", "source_line": 3}]
    write_module_shards(tmp_path, ["r"], [{"id": "module:r:m", "repository": "r", "path": "m"}], [], syms, rels)
    _jsonl(tmp_path / "stories.jsonl", [{"id": "story:atlas:s", "title": "T", "group": "history", "date": "2024", "status": "draft",
                                          "chapters": [{"title": "c", "text": 'It says "Fix the widget thing" once.', "commits": ["commit:r:c1"]}]}])
    _manifest(tmp_path)
    return tmp_path


def _fails(ds: Path, capsys, needle: str) -> None:
    assert validate_dataset(ds) is False
    assert needle in capsys.readouterr().out


def test_valid_dataset_passes(ds):
    assert validate_dataset(ds) is True


def test_changed_file_fails_hash_and_size(ds, capsys):
    p = ds / "repos.jsonl"
    p.write_text(p.read_text().replace('"name": "r"', '"name": "q"'))   # same length, different content
    _fails(ds, capsys, "repos.jsonl: sha256 differs")


def test_unlisted_and_missing_files_fail(ds, capsys):
    (ds / "extra.jsonl").write_text("{}\n")
    _fails(ds, capsys, "extra.jsonl is not listed")
    (ds / "extra.jsonl").unlink()
    (ds / "modules.jsonl").unlink()
    _fails(ds, capsys, "manifest lists missing file modules.jsonl")


def test_incompatible_schema_and_missing_field_fail(ds, capsys):
    m = json.loads((ds / "manifest.json").read_text()); m["schema_version"] = "9.0"
    (ds / "manifest.json").write_text(json.dumps(m))
    _fails(ds, capsys, "schema_version 9.0")
    _manifest(ds)
    _jsonl(ds / "modules.jsonl", [{"id": "module:r:m", "repository": "r"}])
    _manifest(ds)
    _fails(ds, capsys, "lacks path")


def test_unpinned_sha_and_foreign_revision_fail(ds, capsys):
    m = json.loads((ds / "manifest.json").read_text()); m["sources"][0]["sha"] = "abc"
    (ds / "manifest.json").write_text(json.dumps(m))
    _fails(ds, capsys, "not a full 40-character SHA")
    _manifest(ds)
    rel = ds / "relationships/r/m.jsonl"
    rel.write_text(rel.read_text().replace(SHA, "b" * 40))
    _manifest(ds)
    _fails(ds, capsys, "cites revision")


def test_unsafe_paths_fail(ds, capsys):
    _jsonl(ds / "modules.jsonl", [{"id": "module:r:m", "repository": "r", "path": "../etc"}])
    _manifest(ds)
    _fails(ds, capsys, "path '../etc'")


def test_shard_index_must_match_shard_files(ds, capsys):
    ix = ds / "shards/r.json"
    data = json.loads(ix.read_text()); data["n"][data["keys"].index("m")][0] = 5
    ix.write_text(json.dumps(data))
    _manifest(ds)
    _fails(ds, capsys, "index says 5")


def test_incoming_edge_must_exist_in_a_relationship_shard(ds, capsys):
    _jsonl(ds / "incoming/r/m.jsonl", [{"source": "symbol:r:p.X", "target": "symbol:r:p.B", "type": "CALLS", "repository": "r",
                                         "source_revision": SHA, "source_line": 9}])
    ix = ds / "shards/r.json"
    data = json.loads(ix.read_text()); data["n"][data["keys"].index("m")][2] = 1
    ix.write_text(json.dumps(data))
    _manifest(ds)
    _fails(ds, capsys, "is in no relationship shard")


def test_story_text_artefacts_fail(ds, capsys):
    row = json.loads((ds / "stories.jsonl").read_text())
    row["chapters"][0]["text"] = 'A \\"quoted\\" subject'
    _jsonl(ds / "stories.jsonl", [row])
    _manifest(ds)
    _fails(ds, capsys, "contains a backslash")
    row["chapters"][0]["text"] = 'An "unbalanced quote'
    _jsonl(ds / "stories.jsonl", [row])
    _manifest(ds)
    _fails(ds, capsys, "odd number of double quotes")


def test_quoting_an_uncited_commit_subject_only_warns():
    rows = {"commits": [{"id": "commit:r:c1", "subject": "Fix the widget thing"}],
            "stories": [{"id": "story:atlas:s", "chapters": [{"text": 'It says "Fix the widget thing".'}]}]}
    assert len(story_warnings(rows)) == 1
    rows["stories"][0]["chapters"][0]["commits"] = ["commit:r:c1"]
    assert story_warnings(rows) == []
