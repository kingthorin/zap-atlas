import json

from atlas.config import AtlasConfig
from atlas.manifest import AtlasGenerator


def test_history_is_sharded_by_repo_and_year(tmp_path):
    gen = AtlasGenerator(AtlasConfig())
    gen.rows["commits.jsonl"] = [
        {"id": "commit:r:1", "repository": "r", "committer_date": "2021-05-01T10:00:00+00:00"},
        {"id": "commit:r:2", "repository": "r", "committer_date": "2022-01-01T10:00:00+00:00"},
    ]
    gen.rows["files.jsonl"] = [
        {"id": "f1", "commit": "commit:r:1", "repository": "r"},
        {"id": "f2", "commit": "commit:r:2", "repository": "r"},
        {"id": "f3", "commit": "commit:r:2", "repository": "r"},
    ]
    names = gen._write_history_shards(tmp_path)
    assert set(names) == {"commits/r/2021.jsonl", "commits/r/2022.jsonl",
                          "files/r/2021.jsonl", "files/r/2022.jsonl", "history_index.json"}
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
