import json
from pathlib import Path

import pytest

from atlas.stories import load_stories
from atlas.validate import validate_dataset

GOOD = {
    "title": "T", "description": "D", "group": "history", "date": "2019-04", "status": "draft",
    "chapters": [
        {"title": "c1", "text": "x", "commits": ["commit:r:a"], "entities": ["repo:r"],
         "evidence": [{"label": "L", "url": "https://example.org/p"}]},
        {"title": "c2", "text": "y", "commits": ["commit:r:a"]},
    ],
}


def _story(tmp_path, name="s", **over):
    d = tmp_path / "stories"
    d.mkdir(exist_ok=True)
    (d / f"{name}.json").write_text(json.dumps({**GOOD, **over}))
    return d


def test_loader_builds_row_with_unions(tmp_path):
    (row,) = load_stories(_story(tmp_path))
    assert row["id"] == "story:atlas:s" and row["status"] == "draft"
    assert row["commits"] == ["commit:r:a"] and row["entities"] == ["repo:r"]
    assert row["evidence"] == ["https://example.org/p"]
    assert (row["group"], row["date"]) == ("history", "2019-04")


@pytest.mark.parametrize("over,msg", [
    ({"status": "final"}, "status"), ({"chapters": []}, "chapter"), ({"title": None}, None),
    ({"group": "misc"}, "group"), ({"date": "June 2019"}, "date")])
def test_loader_rejects_bad_stories(tmp_path, over, msg):
    d = _story(tmp_path, **{k: v for k, v in over.items() if v is not None})
    if over.get("title", 1) is None:
        raw = json.loads((d / "s.json").read_text()); del raw["title"]; (d / "s.json").write_text(json.dumps(raw))
    with pytest.raises(ValueError, match=msg or "missing"):
        load_stories(d)


def test_loader_rejects_invalid_json(tmp_path):
    d = tmp_path / "stories"; d.mkdir(); (d / "bad.json").write_text("{")
    with pytest.raises(ValueError, match="bad.json"):
        load_stories(d)


def _dataset(tmp_path, story_row, commits=True):
    (tmp_path / "manifest.json").write_text(json.dumps({"sources": [{"name": "r", "sha": "x"}]}))
    (tmp_path / "repos.jsonl").write_text(json.dumps({"id": "repo:r"}) + "\n")
    if commits:
        (tmp_path / "commits").mkdir()
        (tmp_path / "commits/r").mkdir()
        (tmp_path / "commits/r/2024.jsonl").write_text(json.dumps({"id": "commit:r:a", "parents": []}) + "\n")
    (tmp_path / "stories.jsonl").write_text(json.dumps(story_row) + "\n")


def test_validator_accepts_resolvable_story(tmp_path):
    (row,) = load_stories(_story(tmp_path))
    ds = tmp_path / "ds"; ds.mkdir(); _dataset(ds, row)
    assert validate_dataset(ds) is True


def test_validator_rejects_dangling_reference_and_http_evidence(tmp_path):
    (row,) = load_stories(_story(tmp_path))
    ds = tmp_path / "ds"; ds.mkdir(); _dataset(ds, row, commits=False)
    assert validate_dataset(ds) is False  # commit:r:a not in dataset
    row["chapters"][0]["evidence"][0]["url"] = "http://example.org"
    ds2 = tmp_path / "ds2"; ds2.mkdir(); _dataset(ds2, row)
    assert validate_dataset(ds2) is False


def test_repo_stories_are_well_formed():
    rows = load_stories(Path(__file__).parent.parent / "stories")
    assert rows and all(r["status"] in ("draft", "reviewed") for r in rows)
    assert not any("OWASP ZAP" in json.dumps(r) for r in rows)


def test_story_can_cite_milestones(tmp_path):
    d = tmp_path / "stories"; d.mkdir()
    (d / "m.json").write_text(json.dumps({**{"title": "T", "description": "D", "group": "history", "date": "2023", "status": "draft"},
        "chapters": [{"title": "c", "text": "x", "milestones": ["milestone:zaproxy:2.8.0"]}]}))
    (row,) = load_stories(d)
    assert row["milestones"] == ["milestone:zaproxy:2.8.0"]
    ds = tmp_path / "ds"; ds.mkdir(); _dataset(ds, row)
    assert validate_dataset(ds) is False  # milestone not in dataset
    (ds / "milestones.jsonl").write_text(json.dumps({"id": "milestone:zaproxy:2.8.0", "commits": ["commit:r:a"]}) + "\n")
    assert validate_dataset(ds) is True


def test_repo_stories_have_group_and_date_and_dates_sort_within_groups():
    rows = load_stories(Path(__file__).parent.parent / "stories")
    assert {r["group"] for r in rows} == {"projects", "features", "history"}
    assert all(len(r["date"]) in (4, 7, 10) for r in rows)


def test_narrative_is_optional_and_checked(tmp_path):
    d = tmp_path / "stories"; d.mkdir()
    base = {"title": "T", "description": "D", "group": "history", "date": "2023", "status": "draft", "chapters": [{"title": "c", "text": "x"}]}
    (d / "a.json").write_text(json.dumps(base))
    (d / "b.json").write_text(json.dumps({**base, "narrative": "  First.\n\nSecond.  "}))
    a, b = load_stories(d)
    assert "narrative" not in a and b["narrative"] == "First.\n\nSecond."
    for bad in ("", "   ", 5, "x" * 2501):
        (d / "b.json").write_text(json.dumps({**base, "narrative": bad}))
        with pytest.raises(ValueError, match="narrative"):
            load_stories(d)


def test_narrative_sources_are_labelled_https_links(tmp_path):
    d = tmp_path / "stories"; d.mkdir()
    base = {"title": "T", "description": "D", "group": "history", "date": "2023", "status": "draft", "chapters": [{"title": "c", "text": "x"}]}
    good = [{"label": "Announcement", "url": "https://www.zaproxy.org/blog/x/"}]
    (d / "a.json").write_text(json.dumps({**base, "narrative": "Text.", "narrative_sources": good}))
    (row,) = load_stories(d)
    assert row["narrative_sources"] == good
    for bad in ([{"label": "", "url": "https://x.org/"}], [{"label": "L", "url": "http://x.org/"}], [], "x"):
        (d / "a.json").write_text(json.dumps({**base, "narrative": "Text.", "narrative_sources": bad}))
        with pytest.raises(ValueError, match="narrative_sources"):
            load_stories(d)
    (d / "a.json").write_text(json.dumps({**base, "narrative_sources": good}))
    with pytest.raises(ValueError, match="needs a narrative"):
        load_stories(d)
