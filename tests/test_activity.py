import json

from atlas.activity import build_activity, rebuild_from_shards

MODULES = [{"id": "module:r:addOns/a", "repository": "r", "path": "addOns/a"},
           {"id": "module:r:addOns", "repository": "r", "path": "addOns"},
           {"id": "module:s:addOns/a", "repository": "s", "path": "addOns/a"}]
COMMITS = [{"id": f"commit:r:{n}", "repository": "r", "committer_date": d} for n, d in
           (("1", "2020-01-05T10:00:00Z"), ("2", "2022-06-01T10:00:00Z"), ("3", "2023-03-03T10:00:00Z"))]


def _fc(commit, path, add=0, dele=0, repo="r"):
    return {"commit": f"commit:r:{commit}", "repository": repo, "path": path, "additions": add, "deletions": dele}


def test_first_last_commits_and_lines_per_module_with_longest_prefix():
    files = [_fc("1", "addOns/a/src/A.java", 10, 0), _fc("1", "addOns/a/src/B.java", 5, 1),   # one commit, two files
             _fc("3", "addOns/a/x.md", 0, 4), _fc("2", "addOns/other/y.md", 7, 0),            # other -> the parent module
             _fc("2", "elsewhere/z.txt", 1, 1), _fc("2", "addOns/a/q", 1, 1, repo="nope")]    # no module / unknown repository
    act = build_activity(MODULES, COMMITS, files)
    assert act["module:r:addOns/a"] == {"first": "2020-01-05", "last": "2023-03-03", "commits": 2, "lines": 20}
    assert act["module:r:addOns"] == {"first": "2022-06-01", "last": "2022-06-01", "commits": 1, "lines": 7}
    assert set(act) == {"module:r:addOns/a", "module:r:addOns"}


def test_rebuild_from_shards(tmp_path):
    for name, rows in (("modules.jsonl", MODULES),):
        (tmp_path / name).write_text("".join(json.dumps(r) + "\n" for r in rows))
    (tmp_path / "commits/r").mkdir(parents=True); (tmp_path / "files/r").mkdir(parents=True)
    (tmp_path / "commits/r/2020.jsonl").write_text(json.dumps(COMMITS[0]) + "\n")
    (tmp_path / "files/r/2020.jsonl").write_text(json.dumps(_fc("1", "addOns/a/A.java", 3, 2)) + "\n")
    rebuild_from_shards(tmp_path)
    assert json.loads((tmp_path / "module_activity.json").read_text())["module:r:addOns/a"]["lines"] == 5
