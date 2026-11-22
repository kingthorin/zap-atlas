"""Gradle multi-project / add-on build metadata discovery.

Parses settings.gradle.kts (included projects) and per-module *.gradle.kts
zapAddOn blocks to recover module boundaries, add-on names, statuses, and
add-on dependencies. Tolerant of missing/malformed files.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class GradleModule:
    name: str
    path: str  # relative to repo root
    build_file: str | None
    addon_name: str | None = None
    addon_status: str | None = None
    addon_dependencies: list[str] = field(default_factory=list)


def discover_modules(repo_path: Path) -> list[GradleModule]:
    """Discover all Gradle modules from settings.gradle.kts."""
    modules = []
    settings = repo_path / "settings.gradle.kts"
    if not settings.is_file():
        return modules
    text = settings.read_text(errors="replace")
    # include("addOns:ascanrules") / include("addOns") / include("zap")
    for m in re.finditer(r'include\s*\(\s*"([^"]+)"\s*\)', text):
        mod = m.group(1)
        path = Path(mod)
        modules.append(GradleModule(name=mod, path=str(path),
                                    build_file=str(path / f"{path.name}.gradle.kts") if path.parts else None))
    return modules


def parse_addon_block(build_text: str) -> dict:
    """Extract zapAddOn { ... } metadata (name, status, dependencies)."""
    info = {"addon_name": None, "addon_status": None, "dependencies": []}
    m = re.search(r'addOnName\.set\("([^"]+)"\)', build_text)
    if m:
        info["addon_name"] = m.group(1)
    m = re.search(r'addOnStatus\.set\(AddOnStatus\.(\w+)\)', build_text)
    if m:
        info["addon_status"] = m.group(1)
    # dependencies { addOns { register("x") ... } }
    for m in re.finditer(r'register\("([^"]+)"\)', build_text):
        dep = m.group(1)
        if dep not in info["dependencies"]:
            info["dependencies"].append(dep)
    return info

