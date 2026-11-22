"""Complete Git history extraction (commit DAG, refs, tags, file changes, renames).

Git CLI is the source of truth. All commits reachable from selected refs are
preserved, including merge parents. The DAG is NOT flattened into a date list.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Commit:
    sha: str
    parents: list[str] = field(default_factory=list)
    author_name: str = ""
    author_email_norm: str = ""  # normalized, never raw
    author_date: str = ""
    committer_name: str = ""
    committer_date: str = ""
    subject: str = ""
    message: str = ""
    branches: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)


@dataclass
class FileChange:
    sha: str
    path: str
    change_type: str  # A, D, M, R, C, T, U
    old_path: str | None = None  # for renames/copies
    additions: int = 0
    deletions: int = 0


@dataclass
class Ref:
    name: str
    type: str  # branch or tag
    sha: str


class GitHistory:
    """In-memory representation of a repo's Git history."""

    def __init__(self, repo_name: str) -> None:
        self.repo_name = repo_name
        self.commits: dict[str, Commit] = {}
        self.refs: list[Ref] = []
        self.file_changes: list[FileChange] = []

    def commit(self, sha: str) -> Commit | None:
        return self.commits.get(sha)


def extract(repo_path: Path, repo_name: str) -> GitHistory:
    """Extract complete history from a non-shallow clone."""
    history = GitHistory(repo_name)

    # All commits reachable from all refs, with parents and full message.
    fmt = "%H%x00%P%x00%an%x00%ae%x00%ad%x00%cn%x00%cd%x00%s%x00%B%x00%x01"
    out = _git(repo_path, ["git", "log", "--all", f"--format={fmt}", "--reverse"])
    for record in out.split("\x01"):
        record = record.strip("\x00 ").strip()
        if not record:
            continue
        parts = record.split("\x00")
        if len(parts) < 8:
            continue
        sha, parents, an, ae, ad, cn, cd, subject = parts[:8]
        message = parts[8] if len(parts) > 8 else ""
        parent_list = [p for p in parents.split() if p]
        history.commits[sha] = Commit(
            sha=sha,
            parents=parent_list,
            author_name=an,
            author_email_norm=_normalize_email(ae),
            author_date=ad,
            committer_name=cn,
            committer_date=cd,
            subject=subject,
            message=message,
        )

    # Branches and tags.
    for line in _git(repo_path, ["git", "for-each-ref",
                                 "--format=%(refname)%00%(objectname)%00%(refname:short)"]).splitlines():
        if not line:
            continue
        refname, sha, short = line.split("\x00")
        rtype = "tag" if refname.startswith("refs/tags/") else "branch"
        history.refs.append(Ref(name=short, type=rtype, sha=sha))

    # Tag/commit membership.
    for ref in history.refs:
        if ref.type == "tag" and ref.sha in history.commits:
            history.commits[ref.sha].tags.append(ref.name)

    # File changes per commit (with rename/copy detection). --root includes
    # the root commit so its additions are captured too. --name-status gives
    # reliable status letters (A/D/M/R/C/T/U) with old+new paths for R/C.
    for sha in history.commits:
        raw = _git(repo_path, [
            "git", "diff-tree", "-r", "-M", "--find-renames", "--no-commit-id",
            "--root", "--name-status", sha,
        ])
        for line in raw.splitlines():
            if not line:
                continue
            parts = line.split("\t")
            status = parts[0]
            # status may be like "R100" or "C100"; the letter is the first char.
            letter = status[0] if status else "M"
            old_path = None
            if letter in ("R", "C") and len(parts) >= 3:
                old_path, path = parts[1], parts[2]
            else:
                path = parts[-1]
            history.file_changes.append(FileChange(
                sha=sha, path=path, change_type=letter,
                old_path=old_path,
            ))

    return history


def _git(repo_path: Path, cmd: list[str]) -> str:
    return subprocess.run(cmd, cwd=repo_path, capture_output=True, text=True, check=True).stdout


def _normalize_email(email: str) -> str:
    """Normalize contributor identifier; never publish raw email."""
    if not email:
        return "unknown"
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain}" if domain else "user"

