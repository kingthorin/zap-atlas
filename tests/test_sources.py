import subprocess

from atlas.config import AtlasConfig, SourceRepo
from atlas.sources import checkout_sources


def _git(cwd, *a):
    return subprocess.run(["git", "-C", str(cwd), "-c", "user.name=t", "-c", "user.email=t@example.com", *a],
                          check=True, capture_output=True, text=True).stdout.strip()


def test_refresh_follows_remote_branch_not_stale_local(tmp_path):
    origin = tmp_path / "origin"
    origin.mkdir()
    _git(origin, "init", "-q", "-b", "trunk")  # default branch is deliberately not "main"
    (origin / "a").write_text("1")
    _git(origin, "add", "-A"); _git(origin, "commit", "-q", "-m", "c1")

    def run():
        cfg = AtlasConfig(sources=[SourceRepo(name="r", url=str(origin))])
        checkout_sources(cfg, tmp_path / "sources")
        return cfg.sources[0]

    first = run()
    assert first.sha == _git(origin, "rev-parse", "HEAD") and first.default_branch == "trunk"
    (origin / "a").write_text("2")
    _git(origin, "commit", "-q", "-am", "c2")
    second = run()  # existing clone: must pick up c2
    assert second.sha == _git(origin, "rev-parse", "HEAD") != first.sha


def test_ref_overrides_apply_per_repository_and_tolerate_empty_input():
    import pytest
    from atlas.config import AtlasConfig, apply_ref_overrides
    cfg = AtlasConfig()
    apply_ref_overrides(cfg, "", "")                      # a scheduled run passes empty strings
    assert all(s.branch is None for s in cfg.sources)
    apply_ref_overrides(cfg, "v1", '{"zaproxy": "v2.15.0"}')
    refs = {s.name: s.branch for s in cfg.sources}
    assert refs["zaproxy"] == "v2.15.0" and refs["zap-hud"] == "v1"
    with pytest.raises(ValueError, match="unknown repositories"):
        apply_ref_overrides(AtlasConfig(), "", '{"nope": "main"}')
