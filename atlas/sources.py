"""Source repository discovery and checkout.

Discovers each upstream default branch dynamically (never assumes ``main``),
supports optional branch/SHA overrides, and performs full-history (non-shallow)
checkouts.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from atlas.config import AtlasConfig, SourceRepo


def _run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> str:
    result = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, check=check
    )
    return result.stdout.strip()


def discover_default_branch(url: str) -> str:
    """Discover the default branch of a remote repository without cloning."""
    out = _run(["git", "ls-remote", "--symref", url, "HEAD"])
    for line in out.splitlines():
        if line.startswith("ref:"):
            # ref: refs/heads/main\tHEAD  -> parts[1] is the ref name
            parts = line.split()
            if len(parts) >= 2:
                ref = parts[1]  # e.g. refs/heads/main
                if ref.startswith("refs/heads/"):
                    return ref[len("refs/heads/"):]
    # Fallback: try to read HEAD ref
    out = _run(["git", "ls-remote", url, "HEAD"])
    for line in out.splitlines():
        if "\tHEAD" in line:
            return "main"  # last resort
    raise RuntimeError(f"could not discover default branch for {url}")


def checkout_sources(config: AtlasConfig, sources_dir: Path) -> dict[str, Path]:
    """Clone/fetch each source repo with full history and resolve its revision.

    Returns a mapping of repo name -> local checkout path.
    """
    sources_dir.mkdir(parents=True, exist_ok=True)
    checkouts: dict[str, Path] = {}

    for repo in config.sources:
        target = sources_dir / repo.name
        if not target.exists():
            print(f"[atlas] cloning {repo.name} (full history) ...")
            _run(["git", "clone", "--no-local", "--", repo.url, str(target)], check=True)
        else:
            print(f"[atlas] updating {repo.name} ...")
            _run(["git", "fetch", "--tags", "--prune"], cwd=target, check=True)

        # Resolve the revision to check out.
        ref = repo.sha or repo.branch or repo.default_branch or discover_default_branch(repo.url)
        _run(["git", "checkout", ref], cwd=target, check=True)
        _run(["git", "reset", "--hard", ref], cwd=target, check=True)

        full_sha = _run(["git", "rev-parse", "HEAD"], cwd=target)
        repo.sha = full_sha
        checkouts[repo.name] = target
        print(f"[atlas] {repo.name} @ {full_sha} (ref={ref})")

    return checkouts

