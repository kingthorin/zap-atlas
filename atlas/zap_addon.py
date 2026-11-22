"""ZapAddOn.xml manifest parsing for add-on metadata."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ZapAddOn:
    addon_id: str
    name: str
    version: str
    description: str = ""
    author: str = ""
    url: str = ""
    status: str = ""
    dependencies: list[str] = field(default_factory=list)
    extensions: list[str] = field(default_factory=list)


def parse_zap_addon(xml_path: Path) -> ZapAddOn | None:
    if not xml_path.is_file():
        return None
    try:
        root = ET.parse(xml_path).getroot()
    except ET.ParseError:
        return None
    ns = {"z": root.tag.split("}")[0].strip("{")} if "}" in root.tag else {}
    def find(tag):
        if ns:
            return root.find(f"z:{tag}", ns)
        return root.find(tag)
    def findall(tag):
        if ns:
            return root.findall(f"z:{tag}", ns)
        return root.findall(tag)
    addon_id = (findtext(find, "id") or "").strip()
    name = (findtext(find, "name") or "").strip()
    version = (findtext(find, "version") or "").strip()
    desc = (findtext(find, "description") or "").strip()
    author = (findtext(find, "author") or "").strip()
    url = (findtext(find, "url") or "").strip()
    status = (findtext(find, "status") or "").strip()
    deps = [d.text.strip() for d in findall("dependency") if d.text]
    exts = [e.text.strip() for e in findall("extension") if e.text]
    return ZapAddOn(addon_id=addon_id, name=name, version=version,
                    description=desc, author=author, url=url, status=status,
                    dependencies=deps, extensions=exts)


def findtext(elem, tag):
    if elem is None:
        return None
    child = elem.find(tag)
    return child.text if child is not None else None

