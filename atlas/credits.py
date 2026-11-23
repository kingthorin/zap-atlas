"""Core team over time, from the history of the help credits page.

The page lists the team in its first section: "ZAP" (2010), "ZAP development" (2011 to 2013) and then
"ZAP Core Team" (2014 on). Every commit of the page (``credits.html``, followed through its moves) is one
snapshot, so a person's interval runs from the first snapshot that lists them to the first later snapshot
that does not (open if they are in the latest). Short absences are ignored, since a page edit can drop and
restore a row.

Names are matched across snapshots by canonical name: ``Name (Alias)`` and links to ``/docs/team/<handle>/``
make the alias or handle an alias of the name, so "Psiinon", "psiinon" and "Simon Bennetts" are one person.
A name that is a longer form of another (``Cosmin Stefan`` and ``Cosmin Stefan-Dobrin``) is the same person.
A row that contains an email address is skipped, and sponsor and company suffixes (``Name - Mozilla``) are cut.
"""
from __future__ import annotations

import html
import re
import subprocess
from datetime import date
from pathlib import Path

from atlas.git_history import EMAIL_RE

CREDITS_FILE = "addOns/help/src/main/javahelp/contents/credits.html"
CORE_TEAM = "core_team.json"
GAP_DAYS = 60            # an absence shorter than this is a page edit, not a departure

_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.I | re.S)
_CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.I | re.S)
_TAG = re.compile(r"<[^>]+>")
_HANDLE = re.compile(r"/docs/team/([A-Za-z0-9_-]+)/?")


def parse_team(page: str) -> list[tuple[str, str, str]]:
    """(name, alias, handle) for each row of the page's first section; alias and handle may be empty."""
    parts = re.split(r"<h2[^>]*>", page, flags=re.I)
    if len(parts) < 2:
        return []
    out = []
    for row in _ROW.findall(parts[1].split("</h2>", 1)[-1] if "</h2>" in parts[1] else parts[1]):
        cells = [c for c in _CELL.findall(row) if _TAG.sub("", c).replace("&nbsp;", "").strip()]
        if not cells:
            continue
        cell = cells[0]
        text = " ".join(html.unescape(_TAG.sub("", cell)).replace("\xa0", " ").split())
        if EMAIL_RE.search(text):
            continue
        handle = (_HANDLE.search(cell) or [None, ""])[1]
        alias = ""
        if m := re.search(r"\(([^)]*)\)", text):
            alias = m.group(1).lstrip("@").strip()
            if " " in alias or alias.lower() in ("linkedin", "twitter", "github", "sponsor"):
                alias = ""
        name = re.split(r"\s+[-–—]\s+|,\s", re.sub(r"\([^)]*\)", "", text))[0].strip()
        if name:
            out.append((name, alias, handle))
    return out


def canonical_names(snapshots: list[list[tuple[str, str, str]]]) -> dict[str, str]:
    """alias (lower case) -> full name, from every ``Name (Alias)`` and ``/docs/team/<handle>/`` seen."""
    aliases: dict[str, str] = {}
    for rows in snapshots:
        for name, alias, handle in rows:
            if " " in name:
                for a in (alias, handle):
                    if a:
                        aliases[a.lower()] = name
    names = sorted({n for rows in snapshots for n, _, _ in rows})
    for short in names:                       # "Cosmin Stefan" is the same person as "Cosmin Stefan-Dobrin"
        if " " in short:
            longer = [n for n in names if n != short and n.startswith(short) and n[len(short)] in " -"]
            if len(longer) == 1:
                aliases.setdefault(short.lower(), longer[0])
    return aliases


def build_core_team(snapshots: list[tuple[str, list[tuple[str, str, str]]]]) -> list[dict]:
    """snapshots: (YYYY-MM-DD, rows) oldest first. Returns [{"name", "intervals": [[start, end or None]]}]."""
    aliases = canonical_names([rows for _, rows in snapshots])
    present: dict[str, list[tuple[str, bool]]] = {}
    names_at: list[set[str]] = []
    for _, rows in snapshots:
        names_at.append({aliases.get(n.lower(), n) for n, _, _ in rows})
    everyone = sorted(set().union(*names_at)) if names_at else []
    people = []
    for name in everyone:
        intervals: list[list[str | None]] = []
        open_start = None
        for (day, _), names in zip(snapshots, names_at):
            if name in names and open_start is None:
                open_start = day
            elif name not in names and open_start is not None:
                intervals.append([open_start, day])
                open_start = None
        if open_start is not None:
            intervals.append([open_start, None])
        merged: list[list[str | None]] = []
        for iv in intervals:                    # bridge short absences
            if merged and merged[-1][1] and (date.fromisoformat(iv[0]) - date.fromisoformat(merged[-1][1])).days < GAP_DAYS:
                merged[-1][1] = iv[1]
            else:
                merged.append(iv)
        people.append({"name": name, "intervals": merged})
    return sorted(people, key=lambda p: (p["intervals"][0][0], p["name"]))


def credits_history(repo_path: Path) -> list[tuple[str, str]]:
    """(commit date, page text) for every commit of the credits page, oldest first, following moves."""
    out = subprocess.run(["git", "log", "--follow", "--name-only", "--format=@@%H %cs", "--", CREDITS_FILE],
                         cwd=repo_path, capture_output=True, text=True, check=True).stdout
    versions: list[list[str]] = []
    for line in out.splitlines():
        if line.startswith("@@"):
            versions.append(line[2:].split())
        elif line.strip() and versions and len(versions[-1]) == 2:
            versions[-1].append(line.strip())
    snaps = []
    for v in reversed([v for v in versions if len(v) == 3]):
        raw = subprocess.run(["git", "show", f"{v[0]}:{v[2]}"], cwd=repo_path, capture_output=True).stdout
        text = raw.decode("utf-8", "replace")             # early versions are not all UTF-8
        snaps.append((v[1], text))
    return snaps


def core_team(repo_path: Path) -> dict | None:
    """The core team over time for a checkout of zap-core-help, or None when it has no credits page."""
    if not (repo_path / CREDITS_FILE).is_file():
        return None
    snaps = [(day, parse_team(text)) for day, text in credits_history(repo_path)]
    snaps = [(d, rows) for d, rows in snaps if rows]
    return {"source": CREDITS_FILE, "snapshots": len(snaps), "first": snaps[0][0] if snaps else None, "people": build_core_team(snaps)}
