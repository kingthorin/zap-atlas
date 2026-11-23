"""Modules, add-ons, help documents and their relationships for one repo.

Current structure only (HEAD checkout): older Ant-era revisions are not parsed.
"""

from __future__ import annotations

import posixpath
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
    known_addons = {m.slug or Path(m.path).name for m in mods if m.is_addon}
    cov = {"modules": len(mods), "addons": 0, "addons_without_status": 0,
           "addons_without_name": 0, "docs": 0, "unresolved_dependencies": 0}
    topics: list[tuple[str, object, str]] = []  # (doc id, HelpTopic, javahelp dir) for link resolution

    for m in mods:
        mid = module_id(repo_name, m.path)
        eco.modules.append(asdict(Module(id=mid, repository=repo_name, name=m.slug or Path(m.path).name,
                                         path=m.path, addon=m.is_addon)))
        eco.relationships.append(asdict(Relationship(
            source=repo_id(repo_name), target=mid, type="CONTAINS", repository=repo_name,
            source_revision=revision, evidence_type="resolved", source_file=m.build_file)))
        if not m.is_addon:
            continue
        slug = m.slug or Path(m.path).name
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
        base = m.path if m.base is None else m.base
        for t in discover_help_topics(repo_path / base / "src" / "main" / "javahelp", repo_path):
            did = doc_id(repo_name, t.path)
            eco.docs.append(asdict(Document(id=did, repository=repo_name, module=mid, path=t.path,
                                            title=t.title, headings=t.headings,
                                            anchors=sorted(set(t.anchors)))))
            cov["docs"] += 1
            topics.append((did, t, f"{base + '/' if base else ''}src/main/javahelp"))
            eco.relationships.append(asdict(Relationship(
                source=did, target=addon_id(slug), type="DOCUMENTS", repository=repo_name,
                source_revision=revision, evidence_type="resolved", source_file=t.path)))
    _resolve_doc_links(repo_name, repo_path, revision, topics, eco, cov)
    eco.coverage = cov
    return eco


def _resolve_doc_links(repo_name, repo_path, revision, topics, eco, cov) -> None:
    """REFERENCES edges between help pages; every other link is counted, never dropped silently."""
    by_path = {t.path: (did, t) for did, t, _ in topics}
    stats = {"links_total": 0, "links_resolved": 0, "links_external": 0, "links_other_scheme": 0,
             "links_to_other_files": 0, "links_broken": 0, "anchors_broken": 0, "images_missing": 0}
    seen = set()
    shared = repo_path / "commonFiles" / "src" / "main" / "resources"  # merged into every help add-on at build time
    for did, t, jh in topics:
        for href in t.links:
            stats["links_total"] += 1
            href = href.strip()
            if re.match(r"https?://", href, re.I):
                stats["links_external"] += 1
                continue
            if re.match(r"[a-z][a-z0-9+.-]*:", href, re.I):
                stats["links_other_scheme"] += 1  # mailto:, javascript:, JavaHelp map ids, ...
                continue
            file_part, _, anchor = href.partition("#")
            target = t.path if not file_part else posixpath.normpath(posixpath.join(posixpath.dirname(t.path), file_part))
            hit = by_path.get(target)
            if hit:
                tid, tt = hit
                stats["links_resolved"] += 1
                if anchor and anchor not in tt.anchors:
                    stats["anchors_broken"] += 1
                if tid != did and (did, tid) not in seen:
                    seen.add((did, tid))
                    eco.relationships.append(asdict(Relationship(
                        source=did, target=tid, type="REFERENCES", repository=repo_name,
                        source_revision=revision, evidence_type="resolved", source_file=t.path)))
            elif (repo_path / target).exists():
                stats["links_to_other_files"] += 1
            else:
                stats["links_broken"] += 1
        for src in t.images:
            if not src.startswith(("http://", "https://", "data:")):
                img = posixpath.normpath(posixpath.join(posixpath.dirname(t.path), src.split("#")[0]))
                if not ((repo_path / img).exists() or (shared / posixpath.relpath(img, jh)).exists()):
                    stats["images_missing"] += 1
    cov.update(stats)
