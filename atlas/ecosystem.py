"""Modules, add-ons, help documents and their relationships for one repo.

Current structure only (HEAD checkout): older Ant-era revisions are not parsed.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

from atlas.gradle_parser import discover_modules
from atlas.help_parser import discover_help_topics
from atlas.schema import (AddOn, Document, Module, Relationship, addon_id,
                          doc_id, module_id, repo_id)

_LOCALE_MODULE = re.compile(r"^help_[a-z]{2,3}_[A-Z]{2}$")


@dataclass
class Ecosystem:
    modules: list[dict] = field(default_factory=list)
    addons: list[dict] = field(default_factory=list)
    docs: list[dict] = field(default_factory=list)
    relationships: list[dict] = field(default_factory=list)
    coverage: dict = field(default_factory=dict)


def discover_ecosystem(repo_name: str, repo_path: Path, revision: str | None = None) -> Ecosystem:
    eco = Ecosystem()
    mods = discover_modules(repo_path)
    known_addons = {Path(m.path).name for m in mods if m.is_addon}
    cov = {"modules": len(mods), "addons": 0, "addons_without_status": 0,
           "addons_without_name": 0, "docs": 0, "unresolved_dependencies": 0}

    for m in mods:
        mid = module_id(repo_name, m.path)
        eco.modules.append(asdict(Module(id=mid, repository=repo_name, name=Path(m.path).name,
                                         path=m.path, addon=m.is_addon)))
        eco.relationships.append(asdict(Relationship(
            source=repo_id(repo_name), target=mid, type="CONTAINS", repository=repo_name,
            source_revision=revision, evidence_type="resolved", source_file=m.build_file)))
        if not m.is_addon:
            continue
        slug = Path(m.path).name
        cov["addons"] += 1
        cov["addons_without_status"] += m.addon_status is None
        cov["addons_without_name"] += m.addon_name is None
        eco.addons.append(asdict(AddOn(
            id=addon_id(slug), module=mid, name=m.addon_name or slug,
            status=(m.addon_status or "").lower() or None, author=m.addon_author or "",
            url=m.addon_url or "", dependencies=[addon_id(d) for d in m.addon_dependencies])))
        for dep in m.addon_dependencies:
            resolved = dep in known_addons
            cov["unresolved_dependencies"] += not resolved
            eco.relationships.append(asdict(Relationship(
                source=addon_id(slug), target=addon_id(dep), type="DEPENDS_ON",
                repository=repo_name, source_revision=revision,
                evidence_type="resolved" if resolved else "syntactic",
                source_file=m.build_file)))

        # English help documents shipped inside this add-on (not locale packs).
        if _LOCALE_MODULE.match(slug):
            continue
        for t in discover_help_topics(repo_path / m.path / "src" / "main" / "javahelp", repo_path):
            did = doc_id(repo_name, t.path)
            eco.docs.append(asdict(Document(id=did, repository=repo_name, module=mid, path=t.path,
                                            title=t.title, headings=t.headings,
                                            anchors=sorted(set(t.anchors)))))
            cov["docs"] += 1
            eco.relationships.append(asdict(Relationship(
                source=did, target=addon_id(slug), type="DOCUMENTS", repository=repo_name,
                source_revision=revision, evidence_type="resolved", source_file=t.path)))
    eco.coverage = cov
    return eco
