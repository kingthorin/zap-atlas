import json

from atlas.activity import build_activity, build_module_timeline, rebuild_from_shards

MODULES = [{"id": "module:r:addOns/a", "repository": "r", "path": "addOns/a"},
           {"id": "module:r:addOns", "repository": "r", "path": "addOns"},
           {"id": "module:s:addOns/a", "repository": "s", "path": "addOns/a"}]
COMMITS = [{"id": f"commit:r:{n}", "repository": "r", "committer_date": d} for n, d in
           (("1", "2020-01-05T10:00:00Z"), ("2", "2022-06-01T10:00:00Z"), ("3", "2023-03-03T10:00:00Z"), ("4", "2024-04-04T10:00:00Z"))]


def _fc(commit, path, add=0, dele=0, repo="r", kind="M", old=None):
    return {"commit": f"commit:r:{commit}", "repository": repo, "path": path, "additions": add, "deletions": dele,
            "change_type": kind, "old_path": old}


def test_first_last_commits_and_lines_per_module_with_longest_prefix():
    files = [_fc("1", "addOns/a/src/A.java", 10, 0), _fc("1", "addOns/a/src/B.java", 5, 1),   # one commit, two files
             _fc("3", "addOns/a/x.md", 0, 4), _fc("2", "addOns/other/y.md", 7, 0),            # other -> the parent module
             _fc("2", "elsewhere/z.txt", 1, 1), _fc("2", "addOns/a/q", 1, 1, repo="nope")]    # no module / unknown repository
    mods, _ = build_activity(MODULES, COMMITS, files)
    assert mods["module:r:addOns/a"] == {"first": "2020-01-05", "last": "2023-03-03", "commits": 2, "lines": 20}
    assert mods["module:r:addOns"] == {"first": "2022-06-01", "last": "2022-06-01", "commits": 1, "lines": 7}
    assert set(mods) == {"module:r:addOns/a", "module:r:addOns"}


def test_renamed_files_keep_their_history_and_move_it_to_the_new_module():
    files = [_fc("1", "src/Old.java", 10, 0, kind="A"),                                  # 2020, before the move
             _fc("3", "addOns/a/New.java", 0, 0, kind="R", old="src/Old.java"),          # 2023: moved into the module
             _fc("4", "addOns/a/New.java", 2, 1)]
    mods, per_file = build_activity(MODULES, COMMITS, files, {"r": {"addOns/a/New.java"}})
    assert mods["module:r:addOns/a"] == {"first": "2020-01-05", "last": "2024-04-04", "commits": 3, "lines": 13}
    assert per_file == {"r": {"addOns/a/New.java": ["2020-01-05", "2024-04-04", 3, 13]}}


def test_a_name_added_again_later_is_a_new_file():
    files = [_fc("1", "addOns/a/T.java", 4, 0, kind="A"), _fc("2", "addOns/a/T.java", 0, 4, kind="D"),
             _fc("3", "addOns/a/T.java", 6, 0, kind="A")]
    _, per_file = build_activity(MODULES, COMMITS, files, {"r": {"addOns/a/T.java"}})
    # credited to the one path; the point is that nothing is lost or duplicated by the add/delete/add sequence
    assert per_file["r"]["addOns/a/T.java"][2] == 3


def test_file_activity_covers_only_requested_files():
    _, per_file = build_activity(MODULES, COMMITS, [_fc("1", "addOns/a/A.java", 1, 1), _fc("1", "addOns/a/B.txt", 1, 1)], {"r": {"addOns/a/A.java"}})
    assert list(per_file["r"]) == ["addOns/a/A.java"]


def test_rebuild_from_shards(tmp_path):
    (tmp_path / "modules.jsonl").write_text("".join(json.dumps(r) + "\n" for r in MODULES))
    for kind, rows in (("commits", [COMMITS[0]]), ("files", [_fc("1", "addOns/a/A.java", 3, 2)]),
                       ("symbols", [{"repository": "r", "file": "file:r:sha:addOns/a/A.java"}])):
        (tmp_path / kind / "r").mkdir(parents=True)
        (tmp_path / kind / "r" / "2020.jsonl").write_text(json.dumps(rows[0]) + "\n")
    assert rebuild_from_shards(tmp_path) == ["module_activity.json", "file_activity.json", "timeline_modules.json"]
    assert json.loads((tmp_path / "module_activity.json").read_text())["module:r:addOns/a"]["lines"] == 5
    assert json.loads((tmp_path / "file_activity.json").read_text())["r"]["addOns/a/A.java"] == ["2020-01-05", "2020-01-05", 1, 5]


def test_module_timeline_counts_commits_authors_and_lines_per_month():
    commits = [dict(c, author_name=a) for c, a in zip(COMMITS, ("ann", "bob", "ann", "bob"))]
    files = [_fc("1", "addOns/a/A.java", 10, 1), _fc("1", "addOns/a/B.java", 5, 0),          # one commit, two files: counts once
             _fc("3", "addOns/a/A.java", 0, 4), _fc("3", "addOns/other/C.java", 2, 0),        # 2023-03: a, and the parent module
             _fc("4", "src/Old.java", 0, 0, kind="R", old="src/Gone.java"), _fc("2", "src/Gone.java", 3, 3)]
    out = build_module_timeline(MODULES, commits, files)
    assert out["module:r:addOns/a"] == {"2020-01": [1, 1, 15, 1], "2023-03": [1, 1, 0, 4]}
    assert out["module:r:addOns"] == {"2023-03": [1, 1, 2, 0]}
