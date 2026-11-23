import json
from pathlib import Path

import pytest

from atlas.cli import main
from atlas.repo_history import history


def _jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def _commit(sha, date, subject, author="ann", parents=("p",)):
    return {"id": f"commit:r:{sha}", "repository": "r", "sha": sha, "parents": list(parents), "author_name": author,
            "committer_date": date, "subject": subject, "message": subject}


def _change(sha, path, kind="M", old=None):
    return {"id": f"file:r:{sha}:{path}", "commit": f"commit:r:{sha}", "repository": "r", "path": path, "change_type": kind,
            "old_path": old, "additions": 0, "deletions": 0}


@pytest.fixture
def ds(tmp_path):
    _jsonl(tmp_path / "repos.jsonl", [{"id": "repo:r", "name": "r", "url": "https://example.org/r.git", "sha": "f" * 40, "default_branch": "main"}])
    _jsonl(tmp_path / "commits/r/2022.jsonl", [_commit("c1", "2022-03-01T10:00:00Z", "Add Old.java"), _commit("c2", "2022-12-31T10:00:00Z", "Tweak Old.java", "bob")])
    _jsonl(tmp_path / "commits/r/2023.jsonl", [_commit("c3", "2023-01-05T10:00:00Z", "Rename to New.java"),
                                               _commit("c4", "2023-06-01T10:00:00Z", "Merge branch", "ann", ("a", "b"))])
    _jsonl(tmp_path / "files/r/2022.jsonl", [_change("c1", "src/Old.java", "A"), _change("c2", "src/Old.java")])
    _jsonl(tmp_path / "files/r/2023.jsonl", [_change("c3", "src/New.java", "R100", "src/Old.java"), _change("c4", "src/Other.java")])
    _jsonl(tmp_path / "milestones.jsonl", [{"id": "milestone:r:v1", "repository": "r", "title": "R 1.0", "kind": "core-release",
                                             "date": "2023-02-01T00:00:00Z"}])
    return tmp_path


def test_overview_counts_years_authors_merges_and_releases(ds):
    text = history(ds, "r")
    assert "4 commits · 2022-03-01 to 2023-06-01 · 2 authors · 1 merges (25.0%)" in text
    assert "2022       2" in text and "2023       2" in text
    assert "75.0%  ann" in text and "25.0%  bob" in text                # top authors with their share
    assert "Releases: 1 core-release" in text and "R 1.0" in text


def test_year_and_since_restrict_the_period(ds):
    assert "2 commits in 2022" in history(ds, "r", year="2022")
    assert "2 commits since 2023-01-01" in history(ds, "r", since="2023-01-01")
    assert "Releases" not in history(ds, "r", year="2022")             # the release is in 2023


def test_path_history_follows_a_rename_back_to_the_old_name(ds):
    text = history(ds, "r", path="src/New.java")
    assert "3 changes in 3 commits" in text and "earlier names: src/Old.java" in text
    assert "(renamed from src/Old.java)" in text and "Add Old.java" in text


def test_directory_history_and_period_filter(ds):
    assert "4 changes" in history(ds, "r", path="src")
    assert "1 changes" in history(ds, "r", path="src/New.java", year="2023")


def test_unknown_repository_or_path_returns_nothing(ds, capsys):
    assert history(ds, "nope") is None and history(ds, "r", path="missing.txt") is None
    assert main(["history", "--dataset", str(ds), "--repository", "r"]) == 0
    assert main(["history", "--dataset", str(ds), "--repository", "nope"]) == 1
