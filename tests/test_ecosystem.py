from atlas.ecosystem import discover_ecosystem


def test_modules_and_addons(ecosystem_repo):
    eco = discover_ecosystem("fix", ecosystem_repo)
    mods = {m["path"]: m for m in eco.modules}
    assert set(mods) == {"addOns/alpha", "addOns/beta", "addOns/broken", "addOns/plain", "zap"}
    assert mods["zap"]["addon"] is False and mods["addOns/plain"]["addon"] is False
    addons = {a["id"]: a for a in eco.addons}
    assert set(addons) == {"addon:alpha", "addon:beta", "addon:broken"}
    a = addons["addon:alpha"]
    assert (a["name"], a["status"], a["author"], a["url"]) == (
        "Alpha add-on", "release", "Someone", "https://example.org/alpha")
    # extension class names are not add-on dependencies
    assert a["dependencies"] == ["addon:beta", "addon:missing"]
    assert addons["addon:beta"]["status"] is None


def test_dependency_evidence(ecosystem_repo):
    eco = discover_ecosystem("fix", ecosystem_repo)
    deps = {r["target"]: r["evidence_type"] for r in eco.relationships if r["type"] == "DEPENDS_ON"}
    assert deps == {"addon:beta": "resolved", "addon:missing": "syntactic"}
    assert eco.coverage["unresolved_dependencies"] == 1
    assert eco.coverage["addons_without_status"] == 2


def test_help_docs_english_only_and_relative(ecosystem_repo):
    eco = discover_ecosystem("fix", ecosystem_repo)
    assert len(eco.docs) == 1
    d = eco.docs[0]
    assert d["path"].startswith("addOns/alpha/") and not d["path"].startswith("/")
    assert d["title"] == "Alpha" and set(d["anchors"]) == {"top", "sec"}
    assert d["module"] == "module:fix:addOns/alpha"
    assert any(r["type"] == "DOCUMENTS" and r["source"] == d["id"] and r["target"] == "addon:alpha"
               for r in eco.relationships)


def test_help_links_become_references_and_are_counted(tmp_path):
    h = tmp_path / "addOns/a/src/main/javahelp/org/x/help/contents"
    h.mkdir(parents=True)
    (tmp_path / "addOns/a").joinpath("a.gradle.kts").write_text('zapAddOn { addOnName.set("A") }')
    (h / "a.html").write_text('<h1>A</h1><a href="b.html#top">b</a> <a href="b.html#nope">b2</a> <a href="#me">self</a>'
                              '<a href="missing.html">m</a><a href="https://example.org/">e</a><a href="map:x">map</a>'
                              '<a name="me"></a><img src="images/gone.png">')
    (h / "b.html").write_text('<h1>B</h1><a name="top"></a>')
    eco = discover_ecosystem("fix", tmp_path)
    refs = [(r["source"].split("/")[-1], r["target"].split("/")[-1]) for r in eco.relationships if r["type"] == "REFERENCES"]
    assert refs == [("a.html", "b.html")]  # one edge per pair; self links make no edge
    c = eco.coverage
    assert (c["links_total"], c["links_resolved"], c["links_external"], c["links_other_scheme"]) == (6, 3, 1, 1)
    assert (c["links_broken"], c["anchors_broken"], c["images_missing"]) == (1, 1, 1)


def test_images_from_shared_common_files_are_not_missing(tmp_path):
    h = tmp_path / "addOns/a/src/main/javahelp/contents/ui"
    h.mkdir(parents=True)
    (tmp_path / "addOns/a/a.gradle.kts").write_text('zapAddOn { addOnName.set("A") }')
    (h / "p.html").write_text('<h1>P</h1><img src="../images/shared.png"><img src="../images/nowhere.png">')
    shared = tmp_path / "commonFiles/src/main/resources/contents/images"
    shared.mkdir(parents=True)
    (shared / "shared.png").write_bytes(b"x")
    assert discover_ecosystem("fix", tmp_path).coverage["images_missing"] == 1


def test_single_project_repo_becomes_one_add_on_module(tmp_path):
    (tmp_path / "src/main/javahelp/org/example/help/contents").mkdir(parents=True)
    (tmp_path / "src/main/javahelp/org/example/help/contents/hud.html").write_text("<h1>HUD</h1>")
    (tmp_path / "build.gradle.kts").write_text('zapAddOn { addOnId.set("hud")\\n addOnName.set("HUD - Heads Up Display")\\n addOnStatus.set(AddOnStatus.BETA) }')
    eco = discover_ecosystem("zap-hud", tmp_path)
    assert [(m["id"], m["name"], m["path"], m["addon"]) for m in eco.modules] == [("module:zap-hud:src", "hud", "src", True)]
    assert [(a["id"], a["name"], a["status"]) for a in eco.addons] == [("addon:hud", "HUD - Heads Up Display", "beta")]
    assert [d["path"] for d in eco.docs] == ["src/main/javahelp/org/example/help/contents/hud.html"]


def test_repo_without_gradle_project_has_no_modules(tmp_path):
    (tmp_path / "docs").mkdir()
    assert discover_ecosystem("r", tmp_path).modules == []
