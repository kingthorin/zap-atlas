from atlas.release_windows import build_core_windows

MS = [{"id": "m2", "kind": "core-release", "date": "2020-02-01T00:00:00Z"}, {"id": "m1", "kind": "core-release", "date": "2020-01-01T00:00:00Z"},
      {"id": "x", "kind": "addon-release", "date": "2020-01-15T00:00:00Z"}]


def _c(date, name, repo="zaproxy"):
    return {"repository": repo, "committer_date": date, "author_name": name}


def test_windows_split_commits_between_releases_and_skip_bots():
    commits = [_c("2019-12-01T00:00:00Z", "A"), _c("2020-01-01T00:00:00Z", "A"), _c("2020-01-10T00:00:00Z", "B"),
               _c("2020-01-11T00:00:00Z", "B"), _c("2020-01-12T00:00:00Z", "dependabot[bot]"), _c("2020-01-13T00:00:00Z", "C", "zap-extensions"),
               _c("2020-03-01T00:00:00Z", "A")]
    out = build_core_windows(MS, commits)
    assert out["m1"] == {"n": 2, "top": [["A", 2]]}
    assert out["m2"] == {"n": 3, "top": [["B", 2]]}
