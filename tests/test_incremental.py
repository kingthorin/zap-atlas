"""A repository that has not moved is replayed from the cache, and the result is the same as a full run."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from atlas.config import AtlasConfig, SourceRepo
from atlas.fingerprint import is_current
from atlas.manifest import CACHE_DIR, AtlasGenerator


def _config(url: str, stories: Path) -> AtlasConfig:
    return AtlasConfig(sources=[SourceRepo(name="fix", url=url)], stories_dir=stories)


def _inventory(out: Path) -> dict:
    return {i["name"]: i["sha256"] for i in json.loads((out / "manifest.json").read_text())["inventory"]}


@pytest.fixture
def stories(tmp_path):
    (tmp_path / "stories").mkdir()
    return tmp_path / "stories"


def test_unchanged_repository_is_replayed_without_a_checkout_and_gives_identical_output(gitrepo, stories, tmp_path):
    sources = tmp_path / "sources"
    AtlasGenerator(_config(str(gitrepo), stories)).run(sources, tmp_path / "out1")
    assert list((sources / CACHE_DIR).glob("fix-*.pkl"))
    shutil.rmtree(sources / "fix")                              # nothing to clone or parse from: only the cache can supply it
    again = AtlasGenerator(_config(str(gitrepo), stories))
    assert again.run(sources, tmp_path / "out2") is not None
    assert not (sources / "fix").exists()
    assert _inventory(tmp_path / "out1") == _inventory(tmp_path / "out2")


def test_a_new_commit_invalidates_the_cache_and_only_the_latest_entry_is_kept(gitrepo, stories, tmp_path):
    sources = tmp_path / "sources"
    AtlasGenerator(_config(str(gitrepo), stories)).run(sources, tmp_path / "out1")
    first = {p.name for p in (sources / CACHE_DIR).glob("fix-*.pkl")}
    (gitrepo / "new.txt").write_text("n\n")
    for args in (["add", "-A"], ["-c", "user.name=T", "-c", "user.email=t@e.org", "commit", "-q", "-m", "next"]):
        subprocess.run(["git", *args], cwd=gitrepo, check=True, capture_output=True)
    AtlasGenerator(_config(str(gitrepo), stories)).run(sources, tmp_path / "out2")
    now = {p.name for p in (sources / CACHE_DIR).glob("fix-*.pkl")}
    assert len(now) == 1 and now != first
    assert (sources / "fix" / "new.txt").is_file()                # the moved repository was fetched and parsed
    subprocess.run(["git", "reset", "-q", "--hard", "HEAD~1"], cwd=gitrepo, check=True, capture_output=True)   # leave the shared fixture as it was


def test_same_inputs_skip_the_whole_run_and_force_rebuilds(gitrepo, stories, tmp_path, capsys):
    sources, out = tmp_path / "sources", tmp_path / "out"
    gen = AtlasGenerator(_config(str(gitrepo), stories))
    assert gen.run(sources, out) is not None
    assert is_current(out, gen.fingerprint)
    assert AtlasGenerator(_config(str(gitrepo), stories)).run(sources, out) is None
    assert "up to date" in capsys.readouterr().out
    assert AtlasGenerator(_config(str(gitrepo), stories)).run(sources, out, force=True) is not None


def test_a_changed_story_or_a_damaged_file_means_not_current(gitrepo, stories, tmp_path):
    sources, out = tmp_path / "sources", tmp_path / "out"
    AtlasGenerator(_config(str(gitrepo), stories)).run(sources, out)
    (stories / "s.json").write_text(json.dumps({"title": "x", "description": "d", "audience": "developers", "group": "history",
                                                "date": "2020", "status": "draft", "chapters": [{"title": "c", "text": "t"}]}))
    assert AtlasGenerator(_config(str(gitrepo), stories)).run(sources, out) is not None      # stories are an input
    (out / "repos.jsonl").write_text("{}\n")
    assert AtlasGenerator(_config(str(gitrepo), stories)).run(sources, out) is not None      # a damaged dataset is rebuilt
