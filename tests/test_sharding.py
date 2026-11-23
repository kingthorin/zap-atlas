import json

from atlas.config import AtlasConfig
from atlas.manifest import AtlasGenerator


def test_history_is_sharded_by_repo_and_year(tmp_path):
    gen = AtlasGenerator(AtlasConfig())
    gen.rows["commits.jsonl"] = [
        {"id": "commit:r:1", "repository": "r", "committer_date": "2021-05-01T10:00:00+00:00", "author_name": "a"},
        {"id": "commit:r:2", "repository": "r", "committer_date": "2022-01-01T10:00:00+00:00", "author_name": "a"},
    ]
    gen.rows["files.jsonl"] = [
        {"id": "f1", "commit": "commit:r:1", "repository": "r"},
        {"id": "f2", "commit": "commit:r:2", "repository": "r"},
        {"id": "f3", "commit": "commit:r:2", "repository": "r"},
    ]
    names = gen._write_history_shards(tmp_path)
    assert set(names) == {"commits/r/2021.jsonl", "commits/r/2022.jsonl",
                          "files/r/2021.jsonl", "files/r/2022.jsonl", "history_index.json", "timeline.json"}
    assert len((tmp_path / "files/r/2022.jsonl").read_text().splitlines()) == 2
    assert json.loads((tmp_path / "history_index.json").read_text()) == {
        "r": {"2021": {"commits": 1, "files": 1}, "2022": {"commits": 1, "files": 2}}}


def test_every_repo_gets_symbol_and_relationship_shards_even_when_empty(tmp_path):
    gen = AtlasGenerator(AtlasConfig())
    gen.rows["repos.jsonl"] = [{"id": "repo:code", "name": "code"}, {"id": "repo:docs", "name": "docs"}]
    gen.rows["symbols.jsonl"] = [{"id": "s", "repository": "code"}]
    names = gen._write_repo_shards(tmp_path, "symbols.jsonl", "symbols")
    assert names == ["symbols/code.jsonl", "symbols/docs.jsonl"]
    assert (tmp_path / "symbols/docs.jsonl").read_text() == ""


def test_doc_history_follows_renames(tmp_path):
    from types import SimpleNamespace as NS
    gen = AtlasGenerator(AtlasConfig())
    gen.rows["docs.jsonl"] = [{"repository": "r", "path": "new/h.html"}]
    commits = {s: NS(committer_date=f"2024-0{i}-01T00:00:00Z") for i, s in enumerate(["c1", "c2", "c3"], 1)}
    changes = [NS(sha="c1", path="old/h.html", change_type="A", old_path=None),
               NS(sha="c2", path="new/h.html", change_type="R100", old_path="old/h.html"),
               NS(sha="c3", path="new/h.html", change_type="M", old_path=None),
               NS(sha="c3", path="other.html", change_type="M", old_path=None)]
    gen._attach_doc_history("r", NS(commits=commits, file_changes=changes))
    d = gen.rows["docs.jsonl"][0]
    assert d["commits"] == ["commit:r:c3", "commit:r:c2", "commit:r:c1"] and d["commit_count"] == 3
    assert d["last_changed"] == "2024-03-01T00:00:00Z"
