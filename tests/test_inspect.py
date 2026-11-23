import json
from pathlib import Path

import pytest

from atlas.cli import main
from atlas.inspect import find_entity, inspect_entity, resolve, suggestions
from atlas.sharding import write_module_shards


def _jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


@pytest.fixture
def ds(tmp_path):
    sha = "a" * 40
    mods = [{"id": "module:r:addOns/x", "repository": "r", "path": "addOns/x", "name": "x", "addon": True},
            {"id": "module:r:addOns/y", "repository": "r", "path": "addOns/y", "name": "y", "addon": True}]
    _jsonl(tmp_path / "repos.jsonl", [{"id": "repo:r", "name": "r", "sha": sha}])
    _jsonl(tmp_path / "modules.jsonl", mods)
    _jsonl(tmp_path / "addons.jsonl", [
        {"id": "addon:x", "module": "module:r:addOns/x", "name": "X add-on", "dependencies": ["addon:y"]},
        {"id": "addon:y", "module": "module:r:addOns/y", "name": "Y add-on", "dependencies": []}])
    _jsonl(tmp_path / "milestones.jsonl", [{"id": "milestone:r:x-v1.0", "repository": "r", "title": "X add-on 1.0", "addon": "addon:x",
                                             "date": "2024-01-02T00:00:00Z", "commits": ["commit:r:abc1234567"]}])
    _jsonl(tmp_path / "languages.jsonl", [{"repository": "r", "module": "addOns/x", "language": "Java", "lines": 120}])
    _jsonl(tmp_path / "commits/r/2024.jsonl", [{"id": "commit:r:abc1234567", "repository": "r", "sha": "abc1234567", "parents": [],
                                                 "subject": "Add x", "message": "Add x", "committer_date": "2024-01-02T00:00:00Z"}])
    _jsonl(tmp_path / "stories.jsonl", [{"id": "story:atlas:s", "title": "The x story", "chapters": [
        {"title": "c", "text": "t", "entities": ["addon:x"], "commits": ["commit:r:abc1234567"]}]}])
    syms = [{"id": f"symbol:r:p.{n}", "repository": "r", "file": f"file:r:{sha}:addOns/{d}/src/{n}.java", "qualified_name": f"p.{n}",
             "kind": "class", "signature": n, "start_line": 1, "end_line": 5} for n, d in (("A", "x"), ("B", "y"))]
    rels = [{"source": "symbol:r:p.A", "target": "symbol:r:p.B", "type": "CALLS", "repository": "r", "evidence_type": "resolved",
             "source_file": "addOns/x/src/A.java", "source_line": 3},
            {"source": "addon:x", "target": "addon:y", "type": "DEPENDS_ON", "repository": "r", "evidence_type": "resolved",
             "source_file": "addOns/x/x.gradle.kts"}]
    write_module_shards(tmp_path, ["r"], mods, [], syms, rels)
    return tmp_path


def test_addon_report_has_dependencies_releases_edges_and_stories(ds):
    text = inspect_entity(ds, "addon:x")
    assert "depends on (1): y" in text and "releases: 1, latest X add-on 1.0 (2024-01-02)" in text
    assert "DEPENDS_ON (1; 1 resolved)" in text and "story:atlas:s  The x story" in text


def test_addon_lists_who_requires_it(ds):
    assert "required by (1): x" in inspect_entity(ds, "addon:y")


def test_symbol_report_reads_its_shard_and_shows_both_directions(ds):
    a, b = inspect_entity(ds, "symbol:r:p.A"), inspect_entity(ds, "symbol:r:p.B")
    assert "found in symbols/r/addOns__x.jsonl" in a and "outgoing edges (1)" in a and "p.B" in a
    assert "incoming edges (1)" in b and "p.A" in b            # the edge crosses shards: it comes from incoming/


def test_commit_lookup_accepts_a_sha_prefix_and_shows_tags_and_stories(ds):
    row, where = find_entity(ds, "commit:r:abc1234")
    assert row["subject"] == "Add x" and where == "commits/r/2024.jsonl"
    text = inspect_entity(ds, "commit:r:abc1234567")
    assert "tagged as: X add-on 1.0" in text and "The x story" in text


def test_module_report_shows_languages(ds):
    assert "lines: Java 120" in inspect_entity(ds, "module:r:addOns/x")


def test_unknown_entity_gives_suggestions(ds, capsys):
    assert inspect_entity(ds, "addon:nope") is None
    assert "addon:x" in suggestions(ds, "x")
    assert resolve(ds, "x") == "addon:x" and resolve(ds, "module:r:m") == "module:r:m"
    assert main(["inspect", "--dataset", str(ds), "--entity", "x"]) == 0
    assert main(["inspect", "--dataset", str(ds), "--entity", "nope"]) == 1
    assert "is not in" in capsys.readouterr().out
