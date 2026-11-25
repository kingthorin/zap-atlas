"""Release milestones from git tags.

Which tags count as releases (everything else is counted, not dropped):
* zaproxy: ``2.8.0`` / ``v2.8.0`` (core releases). Weekly tags (``w2020-03-02``), the
  ``svn_N.N`` tags (duplicates of the release tags, all created on one day), ``-mvn``
  and untagged builds are skipped.
* zap-hud: ``v0.19.0`` (HUD releases).
* zest: ``0.37.0`` (Zest releases). browser-extension: ``v0.3.0`` (Browser Extension releases) and ``rec-v0.3.0``
  (Browser Recorder releases, the recorder built from the same repository).
* zap-extensions and zap-core-help: ``<addon>-v<version>`` (add-on releases) and
  legacy ``2.4``-style tags (zap-extensions releases of that era).
The date is the tag's creation date for annotated tags and the tagged commit's date for
lightweight ones; for some early releases that is not the release date (several 2013
tags share one date), so dates are labelled as tag dates in the UI.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from atlas.schema import Milestone, commit_id, milestone_id

CORE_RE = re.compile(r"^v?(\d+\.\d+(?:\.\d+)?)$")
SVN_RE = re.compile(r"^svn_")
WEEKLY_RE = re.compile(r"^w\d{4}-\d\d-\d\d$")
ADDON_RE = re.compile(r"^(?P<addon>[A-Za-z0-9_]+)-v(?P<ver>\d+(?:\.\d+)*)$")


def _tags(repo_path: Path) -> list[tuple[str, str, str]]:
    """(name, commit sha, creation date) for every tag; annotated tags are peeled to their commit."""
    fmt = "%(refname:short)%00%(objecttype)%00%(objectname)%00%(*objectname)%00%(creatordate:iso-strict)"
    out = subprocess.run(["git", "-C", str(repo_path), "for-each-ref", "refs/tags", f"--format={fmt}"],
                         capture_output=True, check=True).stdout.decode("utf8", "replace")
    rows = []
    for line in out.splitlines():
        name, otype, obj, peeled, date = line.split("\0")
        rows.append((name, peeled if otype == "tag" else obj, date))
    return rows


def build_milestones(repo_name: str, repo_path: Path, commits: set[str],
                     addon_names: dict[str, str]) -> tuple[list[dict], dict]:
    """addon_names: add-on directory name -> display name. Returns (milestone rows, coverage)."""
    rows, cov = [], {"core_releases": 0, "addon_releases": 0, "extensions_releases": 0, "hud_releases": 0, "zest_releases": 0, "browser_extension_releases": 0,
                     "skipped_weekly": 0, "skipped_svn": 0, "skipped_other": 0, "addon_tags_for_unknown_addon": 0,
                     "tags_on_unknown_commit": 0}
    for tag, sha, date in sorted(_tags(repo_path), key=lambda t: t[2]):
        m = None
        if repo_name == "zaproxy":
            if c := CORE_RE.match(tag):
                ver = c.group(1)
                m = dict(kind="core-release", version=ver, title=f"ZAP {ver}")
            elif SVN_RE.match(tag):
                cov["skipped_svn"] += 1
                continue
            elif WEEKLY_RE.match(tag):
                cov["skipped_weekly"] += 1
                continue
        elif repo_name == "zap-hud":
            if c := CORE_RE.match(tag):
                m = dict(kind="hud-release", version=c.group(1), title=f"ZAP HUD {c.group(1)}")
        elif repo_name == "zest":
            if c := CORE_RE.match(tag):
                m = dict(kind="zest-release", version=c.group(1), title=f"Zest {c.group(1)}")
        elif repo_name == "browser-extension":
            if c := re.match(r"^(rec-)?v(\d+\.\d+\.\d+)$", tag):
                m = dict(kind="browser-extension-release", version=c.group(2),
                         title=f"{'Browser Recorder' if c.group(1) else 'Browser Extension'} {c.group(2)}")
        else:
            if a := ADDON_RE.match(tag):
                name = a.group("addon")
                known = name in addon_names
                cov["addon_tags_for_unknown_addon"] += not known
                m = dict(kind="addon-release", version=a.group("ver"), addon=f"addon:{name}" if known else None,
                         title=f"{addon_names.get(name, name)} {a.group('ver')}")
            elif repo_name == "zap-extensions" and (c := re.match(r"^(\d+\.\d+)$", tag)):
                m = dict(kind="extensions-release", version=c.group(1), title=f"zap-extensions {c.group(1)}")
        if m is None:
            cov["skipped_other"] += 1
            continue
        if sha not in commits:
            cov["tags_on_unknown_commit"] += 1
            continue
        cov[{"core-release": "core_releases", "addon-release": "addon_releases",
             "extensions-release": "extensions_releases", "hud-release": "hud_releases",
             "zest-release": "zest_releases", "browser-extension-release": "browser_extension_releases"}[m["kind"]]] += 1
        rows.append(Milestone(id=milestone_id(repo_name, tag), repository=repo_name, date=date, tag=tag,
                              commits=[commit_id(repo_name, sha)], **m).__dict__)
    return rows, cov
