import json

from atlas.search_index import build_search_index


def _w(root, rel, rows):
    f = root / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("".join(json.dumps(r) + "\n" for r in rows))


def test_index_groups_and_manifest_registration(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"inventory": [], "chunks": []}))
    _w(tmp_path, "repos.jsonl", [{"id": "repo:r", "name": "r", "url": "https://github.com/o/r.git", "sha": "abc"}])
    _w(tmp_path, "modules.jsonl", [{"id": "module:r:addOns/x", "path": "addOns/x", "repository": "r"}])
    _w(tmp_path, "addons.jsonl", [{"id": "addon:x", "name": "X add-on", "status": "release", "author": "A"}])
    _w(tmp_path, "docs.jsonl", [{"id": "doc:r:h.html", "repository": "r", "path": "h.html", "title": "Help", "headings": ["Help", "Sub"]}])
    _w(tmp_path, "stories.jsonl", [])
    _w(tmp_path, "symbols/r/addOns__x.jsonl", [
        {"id": "symbol:r:p.A", "kind": "class", "qualified_name": "p.A"},
        {"id": "symbol:r:p.A#m()", "kind": "method", "qualified_name": "p.A#m()"}])
    _w(tmp_path, "commits/r/2024.jsonl", [{"id": "commit:r:abcdef0123456", "sha": "abcdef0123456", "repository": "r", "subject": "Fix bug"}])

    names = build_search_index(tmp_path)
    assert names == ["search/ecosystem.json", "search/symbols.json", "search/commits.json"]
    eco = json.loads((tmp_path / "search/ecosystem.json").read_text())
    assert {e["k"] for e in eco} == {"repository", "module", "addon", "doc"}
    doc = next(e for e in eco if e["k"] == "doc")
    assert doc["x"] == "Sub" and "u" not in doc
    assert [s["t"] for s in json.loads((tmp_path / "search/symbols.json").read_text())] == ["p.A"]  # types only
    assert json.loads((tmp_path / "search/commits.json").read_text())[0]["y"] == "2024"
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert set(names) <= set(m["chunks"]) and {i["name"] for i in m["inventory"]} == set(names)
