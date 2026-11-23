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
                          "files/r/2021.jsonl", "files/r/2022.jsonl", "history_index.json", "timeline.json", "module_activity.json"}
    assert len((tmp_path / "files/r/2022.jsonl").read_text().splitlines()) == 2
    assert json.loads((tmp_path / "history_index.json").read_text()) == {
        "r": {"2021": {"commits": 1, "files": 1}, "2022": {"commits": 1, "files": 2}}}


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


def _sym(repo, name, path, size=10):
    return {"id": f"symbol:{repo}:{name}", "repository": repo, "file": f"file:{repo}:sha:{path}", "pad": "x" * size}


def _rel(repo, src, dst, path, kind="CALLS"):
    return {"source": src, "target": dst, "type": kind, "repository": repo, "source_file": path}


def test_module_shards_index_incoming_edges_and_module_graph(tmp_path):
    from atlas.sharding import write_module_shards
    mods = [{"id": f"module:r:{p}", "repository": "r", "path": p} for p in ("addOns", "addOns/a", "addOns/b")]
    syms = [_sym("r", "A", "addOns/a/src/A.java"), _sym("r", "B", "addOns/b/src/B.java"), _sym("r", "Z", "other/Z.java")]
    rels = [_rel("r", "symbol:r:A", "symbol:r:B", "addOns/a/src/A.java"),
            _rel("r", "symbol:r:B", "symbol:r:B", "addOns/b/src/B.java"),
            {"source": "milestone:r:1", "target": "symbol:r:A", "type": "PART_OF", "repository": "r"}]
    names = write_module_shards(tmp_path, ["r"], mods, [], syms, rels)
    index = json.loads((tmp_path / "shards/r.json").read_text())
    assert index["keys"] == ["_meta", "_root", "addOns/a", "addOns/b"]
    assert [index["keys"][i] for i in (index["s"]["A"], index["s"]["B"], index["s"]["Z"])] == ["addOns/a", "addOns/b", "_root"]
    assert "symbols/r/addOns__a.jsonl" in names and "relationships/r/_meta.jsonl" in names
    incoming = [json.loads(l) for l in (tmp_path / "incoming/r/addOns__b.jsonl").read_text().splitlines()]
    assert [(r["source"], r["target"]) for r in incoming] == [("symbol:r:A", "symbol:r:B")]  # cross-shard only
    graph = json.loads((tmp_path / "module_graph.json").read_text())
    assert graph["nodes"] == ["module:r:addOns/a", "module:r:addOns/b"] and graph["edges"] == [[0, 1, "CALLS", 1, "resolved"]]


def test_oversized_module_splits_by_directory_and_small_dirs_stay_in_parent():
    from atlas.sharding import LIMIT, MIN, RepoShards
    weights = {"m/src/big1/A.java": LIMIT, "m/src/big2/B.java": MIN, "m/src/tiny/C.java": 10, "m/top.java": 5}
    plan = RepoShards(["m"], weights)
    assert plan.key_of("m/src/big1/A.java") == "m/src/big1"
    assert plan.key_of("m/src/big2/B.java") == "m/src/big2"
    assert plan.key_of("m/src/tiny/C.java") == "m/src"   # below MIN, falls back to the nearest key
    assert plan.key_of("m/top.java") == "m" and plan.key_of("elsewhere/x") == "_root"
