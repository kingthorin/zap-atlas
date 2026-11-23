import subprocess

from atlas.config import AtlasConfig
from atlas.manifest import AtlasGenerator
from atlas.milestones import build_milestones


def _git(repo, *a):
    return subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@example.com", *a],
                          check=True, capture_output=True, text=True).stdout.strip()


def _repo(tmp_path, tags):
    r = tmp_path / "r"
    r.mkdir()
    _git(r, "init", "-q", "-b", "main")
    (r / "a").write_text("1")
    _git(r, "add", "-A")
    _git(r, "commit", "-q", "-m", "c1", "--date=2020-01-02T00:00:00+0000")
    for name, annotated in tags:
        _git(r, "tag", *(["-a", "-m", "m"] if annotated else []), name)
    return r, _git(r, "rev-parse", "HEAD")


def test_core_release_tags_only(tmp_path):
    r, sha = _repo(tmp_path, [("2.8.0", True), ("v2.10.0", False), ("svn_1.4", False), ("w2020-03-02", False),
                              ("2.4.1-mvn", False), ("untagged-abc", False)])
    rows, cov = build_milestones("zaproxy", r, {sha}, {})
    got = {x["tag"]: (x["kind"], x["version"], x["title"]) for x in rows}
    assert got == {"2.8.0": ("core-release", "2.8.0", "ZAP 2.8.0"), "v2.10.0": ("core-release", "2.10.0", "ZAP 2.10.0")}
    assert (cov["core_releases"], cov["skipped_weekly"], cov["skipped_svn"], cov["skipped_other"]) == (2, 1, 1, 2)
    assert all(x["commits"] == [f"commit:zaproxy:{sha}"] for x in rows)   # annotated tags are peeled to the commit


def test_addon_release_tags_link_known_addons(tmp_path):
    r, sha = _repo(tmp_path, [("retire-v70", False), ("gone-v1.2.3", False), ("2.4", False), ("rc-1", False)])
    rows, cov = build_milestones("zap-extensions", r, {sha}, {"retire": "Retire.js"})
    by = {x["tag"]: x for x in rows}
    assert by["retire-v70"]["addon"] == "addon:retire" and by["retire-v70"]["title"] == "Retire.js 70"
    assert by["gone-v1.2.3"]["addon"] is None and cov["addon_tags_for_unknown_addon"] == 1
    assert by["2.4"]["kind"] == "extensions-release"
    assert cov["skipped_other"] == 1


def test_tags_on_commits_outside_history_are_counted_not_emitted(tmp_path):
    r, _ = _repo(tmp_path, [("2.8.0", False)])
    rows, cov = build_milestones("zaproxy", r, set(), {})
    assert rows == [] and cov["tags_on_unknown_commit"] == 1


def test_release_notes_and_addon_links():
    gen = AtlasGenerator(AtlasConfig())
    notes = "addOns/help/src/main/javahelp/contents/releases/2.8.0.html"
    gen.rows["docs.jsonl"] = [{"id": f"doc:zap-core-help:{notes}"}]
    gen.rows["milestones.jsonl"] = [
        {"id": "milestone:zaproxy:2.8.0", "kind": "core-release", "version": "2.8.0", "addon": None, "repository": "zaproxy"},
        {"id": "milestone:zaproxy:2.7.0", "kind": "core-release", "version": "2.7.0", "addon": None, "repository": "zaproxy"},
        {"id": "milestone:zap-extensions:retire-v70", "kind": "addon-release", "version": "70", "addon": "addon:retire",
         "repository": "zap-extensions"}]
    gen._link_milestones()
    ms = {m["id"]: m for m in gen.rows["milestones.jsonl"]}
    assert ms["milestone:zaproxy:2.8.0"]["release_notes"] == f"doc:zap-core-help:{notes}"
    assert ms["milestone:zaproxy:2.7.0"].get("release_notes") is None
    types = {(r["type"], r["source"].split(":")[0]) for r in gen.rows["relationships.jsonl"]}
    assert types == {("DOCUMENTS", "doc"), ("PART_OF", "milestone")}
