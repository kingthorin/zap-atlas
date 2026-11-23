import json

from atlas.timeline import build_timeline, rebuild_from_shards

COMMITS = [
    {"id": "commit:r:1", "repository": "r", "committer_date": "2021-05-01T10:00:00Z", "author_name": "a"},
    {"id": "commit:r:2", "repository": "r", "committer_date": "2021-05-20T10:00:00Z", "author_name": "b"},
    {"id": "commit:r:3", "repository": "r", "committer_date": "2021-05-21T10:00:00Z", "author_name": "a"},
    {"id": "commit:r:4", "repository": "r", "committer_date": "2021-06-02T10:00:00Z", "author_name": "a"},
]


def test_monthly_commits_and_distinct_authors():
    assert build_timeline(COMMITS) == {"r": {"2021-05": [3, 2], "2021-06": [1, 1]}}


def test_rebuild_from_shards(tmp_path):
    (tmp_path / "commits" / "r").mkdir(parents=True)
    (tmp_path / "commits" / "r" / "2021.jsonl").write_text("\n".join(json.dumps(r) for r in COMMITS) + "\n")
    rebuild_from_shards(tmp_path)
    assert json.loads((tmp_path / "timeline.json").read_text()) == {"r": {"2021-05": [3, 2], "2021-06": [1, 1]}}
