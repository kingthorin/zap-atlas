"""Is a generated dataset still what ``atlas analyze`` would produce?

The fingerprint covers everything the output depends on: the commit each upstream repository is at, the
generator's own source, the stories and the settings that change the output. ``atlas analyze`` stores it in
the manifest and skips the work when a dataset with the same fingerprint (and intact files) is already there.
The commit of each repository comes from ``git ls-remote`` alone, so an unchanged dataset is recognised
without cloning anything, and a repository that has not moved can be replayed from the per-repository cache.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

from atlas.config import AtlasConfig, SourceRepo
from atlas.schema import GENERATOR_VERSION, SCHEMA_VERSION

HEX40 = re.compile(r"^[0-9a-f]{40}$")


def _hash_files(root: Path, pattern: str) -> str:
    h = hashlib.sha256()
    for p in sorted(root.glob(pattern)):
        if p.is_file() and "__pycache__" not in p.parts:
            h.update(p.relative_to(root).as_posix().encode())
            h.update(p.read_bytes())
    return h.hexdigest()


def code_hash() -> str:
    """Hash of the generator's own source: a change to it invalidates every cached result."""
    return _hash_files(Path(__file__).parent, "*.py")


def inputs(config: AtlasConfig, shas: dict[str, str]) -> dict:
    """What the output depends on, as plain data."""
    return {
        "sources": dict(sorted(shas.items())),
        "generator": GENERATOR_VERSION,
        "schema": SCHEMA_VERSION,
        "code": code_hash(),
        "stories": _hash_files(config.stories_dir, "*.json"),
        "java_max": os.environ.get("ATLAS_JAVA_MAX", ""),
        "focus": sorted(config.focus_modules or []),
    }


def key(config: AtlasConfig, shas: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(inputs(config, shas), sort_keys=True).encode()).hexdigest()[:32]


def remote_sha(repo: SourceRepo) -> str:
    """The commit a repository will be analysed at, from the remote alone: a pinned SHA, a branch or tag, or the default branch."""
    ref = repo.sha or repo.branch
    if ref and HEX40.match(ref):
        return ref
    if ref:
        lines = subprocess.run(["git", "ls-remote", repo.url, ref, f"{ref}^{{}}"], capture_output=True, text=True, check=True).stdout.split("\n")
        found = {l.split("\t")[1]: l.split("\t")[0] for l in lines if "\t" in l}
        for name in (f"refs/tags/{ref}^{{}}", f"refs/heads/{ref}", f"refs/tags/{ref}", ref):   # a tag's own commit before the tag object
            if name in found:
                return found[name]
        raise RuntimeError(f"{ref} is not a branch or tag of {repo.url}")
    out = subprocess.run(["git", "ls-remote", repo.url, "HEAD"], capture_output=True, text=True, check=True).stdout
    return out.split()[0]


def is_current(dataset: Path, expected: str) -> bool:
    """True when the dataset's manifest carries this fingerprint and every file still matches its recorded hash."""
    manifest = dataset / "manifest.json"
    if not manifest.is_file():
        return False
    data = json.loads(manifest.read_text(encoding="utf-8"))
    if data.get("fingerprint") != expected:
        return False
    from atlas.integrity import check_manifest_files
    return not check_manifest_files(dataset, data)
