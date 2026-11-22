"""Gradle multi-project / add-on build metadata discovery.

Module boundaries come from the filesystem: every ``<dir>/<dir>.gradle.kts``
(the layout the upstream ``settings.gradle.kts`` files enforce) at the repo root
or directly under ``addOns/``. Add-on metadata comes from the ``zapAddOn { }``
block. Tolerant of missing/malformed files; unresolved fields are ``None``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class GradleModule:
    name: str  # path relative to repo root, e.g. "addOns/ascanrules"
    path: str
    build_file: str
    is_addon: bool = False
    addon_name: str | None = None
    addon_status: str | None = None
    addon_author: str | None = None
    addon_url: str | None = None
    addon_dependencies: list[str] = field(default_factory=list)


def _blocks(text: str, name: str) -> list[str]:
    """Bodies of every ``name { ... }`` block (brace-matched)."""
    out = []
    for m in re.finditer(rf"\b{re.escape(name)}\s*\{{", text):
        depth, i = 1, m.end()
        while i < len(text) and depth:
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            i += 1
        out.append(text[m.end():i - 1])
    return out


def parse_addon_block(build_text: str) -> dict:
    """Extract zapAddOn { ... } metadata. Missing values are None / []."""
    info = {"addon_name": None, "addon_status": None, "addon_author": None,
            "addon_url": None, "dependencies": [], "has_block": False}
    blocks = _blocks(build_text, "zapAddOn")
    if not blocks:
        return info
    body = blocks[0]
    info["has_block"] = True
    for key, pat in (
        ("addon_name", r'addOnName\.set\("([^"]+)"\)'),
        ("addon_status", r'addOnStatus\.set\(AddOnStatus\.(\w+)\)'),
        ("addon_author", r'author\.set\("([^"]+)"\)'),
        ("addon_url", r'\burl\.set\("([^"]+)"\)'),
    ):
        m = re.search(pat, body)
        if m:
            info[key] = m.group(1)
    # Only add-on dependencies: register("id") inside dependencies { addOns { } }.
    for dep_block in _blocks(body, "dependencies"):
        for addons_block in _blocks(dep_block, "addOns"):
            for m in re.finditer(r'register\("([^"]+)"\)', addons_block):
                if m.group(1) not in info["dependencies"]:
                    info["dependencies"].append(m.group(1))
    return info


def discover_modules(repo_path: Path) -> list[GradleModule]:
    """Discover Gradle modules by the <dir>/<dir>.gradle.kts convention."""
    candidates = [d for d in sorted(repo_path.iterdir()) if d.is_dir()]
    addons_dir = repo_path / "addOns"
    if addons_dir.is_dir():
        candidates += [d for d in sorted(addons_dir.iterdir()) if d.is_dir()]
    modules = []
    for d in candidates:
        build = d / f"{d.name}.gradle.kts"
        if not build.is_file():
            continue
        rel = d.relative_to(repo_path).as_posix()
        try:
            text = build.read_text(errors="replace")
        except OSError:
            text = ""
        info = parse_addon_block(text)
        in_addons = d.parent == addons_dir
        modules.append(GradleModule(
            name=rel, path=rel, build_file=build.relative_to(repo_path).as_posix(),
            is_addon=in_addons and info["has_block"],
            addon_name=info["addon_name"], addon_status=info["addon_status"],
            addon_author=info["addon_author"], addon_url=info["addon_url"],
            addon_dependencies=info["dependencies"],
        ))
    return modules
