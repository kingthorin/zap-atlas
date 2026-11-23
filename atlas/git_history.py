"""Complete Git history extraction (commit DAG, refs, tags, file changes, renames).

Git CLI is the source of truth. All commits reachable from selected refs are
preserved, including merge parents. The DAG is NOT flattened into a date list.
"""

from __future__ import annotations

import hashlib
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
REDACTED = "[email redacted]"


def scrub_emails(text: str) -> str:
    """Replace anything shaped like an email address (names, trailers, bodies)."""
    return EMAIL_RE.sub(REDACTED, text)


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
    fmt = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%cI%x00%s%x00%B%x00%x01"
    out = _git(repo_path, ["git", "log", "--all", f"--format={fmt}", "--reverse"])
    for record in out.split("\x01"):
        record = record.lstrip("\n")
        if not record.strip():
            continue
        # Keep empty trailing fields (empty subject/body); drop only the format's final NUL.
        parts = record.removesuffix("\x00").split("\x00")
        if len(parts) < 8:
            continue
        sha, parents, an, ae, ad, cn, cd, subject = parts[:8]
        message = scrub_emails(parts[8].strip()) if len(parts) > 8 else ""
        an, subject = scrub_emails(an), scrub_emails(subject)
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

    # File changes with rename/copy detection and line counts. Two single git processes
    # (names and numstat) replace one process per commit, and are joined on (commit, path).
    # --root includes the root commit; merge commits have no diff, as with diff-tree.
    counts = _numstat(repo_path)
    for sha, letter, old_path, path in _name_status(repo_path):
        if sha in history.commits:
            additions, deletions = counts.get((sha, path), (0, 0))
            history.file_changes.append(FileChange(sha=sha, path=path, change_type=letter, old_path=old_path,
                                                   additions=additions, deletions=deletions))

    return history


def _log_tokens(repo_path: Path, mode: str) -> list[str]:
    """NUL-separated tokens of ``git log`` with the given diff mode; a token starting with \\x01 is a commit header."""
    out = subprocess.run(
        ["git", "log", "--all", "--root", "-M", "-z", mode, "--format=%x01%H"],
        cwd=repo_path, capture_output=True, check=True).stdout.decode("utf8", "replace")
    return [t.lstrip("\n") for t in out.split("\0")]


def _name_status(repo_path: Path):
    """(sha, status letter, old path or None, path) for every change. Renames and copies carry two paths."""
    tokens, sha, i = _log_tokens(repo_path, "--name-status"), "", 0
    while i < len(tokens):
        t = tokens[i]
        i += 1
        if t.startswith("\x01"):
            sha = t[1:]
        elif t and sha:
            letter = t[0]
            if letter in ("R", "C"):
                yield sha, letter, tokens[i], tokens[i + 1]
                i += 2
            else:
                yield sha, letter, None, tokens[i]
                i += 1


def _numstat(repo_path: Path) -> dict[tuple[str, str], tuple[int, int]]:
    """(sha, path) -> (lines added, lines deleted); binary files count as 0 and 0."""
    out: dict[tuple[str, str], tuple[int, int]] = {}
    tokens, sha, i = _log_tokens(repo_path, "--numstat"), "", 0
    while i < len(tokens):
        t = tokens[i]
        i += 1
        if t.startswith("\x01"):
            sha = t[1:]
        elif t.count("\t") == 2 and sha:
            added, deleted, path = t.split("\t")
            if not path:                       # a rename or copy: the old and new paths follow as tokens
                path = tokens[i + 1]
                i += 2
            out[(sha, path)] = (int(added) if added.isdigit() else 0, int(deleted) if deleted.isdigit() else 0)
    return out


def _git(repo_path: Path, cmd: list[str]) -> str:
    return subprocess.run(cmd, cwd=repo_path, capture_output=True, text=True, check=True).stdout


def _normalize_email(email: str) -> str:
    """Stable pseudonymous contributor key. The address itself is never published."""
    email = email.strip().lower()
    if not email:
        return "unknown"
    return "u-" + hashlib.sha256(email.encode("utf8")).hexdigest()[:12]
