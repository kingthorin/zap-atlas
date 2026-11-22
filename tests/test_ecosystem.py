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
