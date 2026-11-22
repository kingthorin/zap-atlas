"""Tests for Git history extraction using a fixture repo with a real merge,
branches, a tag, a rename, and a Java file."""
import os
from atlas.git_history import extract


def test_extract_preserves_merge_parents(gitrepo):
    history = extract(gitrepo, "fix")
    # find the merge commit (2 parents)
    merges = [c for c in history.commits.values() if len(c.parents) == 2]
    assert len(merges) == 1, f"expected 1 merge, got {len(merges)}"
    m = merges[0]
    assert m.subject == "c5 merge feature into main", m.subject


def test_extract_preserves_branches_and_tags(gitrepo):
    history = extract(gitrepo, "fix")
    branch_names = {r.name for r in history.refs if r.type == "branch"}
    tag_names = {r.name for r in history.refs if r.type == "tag"}
    assert "main" in branch_names, branch_names
    assert "feature" in branch_names, branch_names
    assert "v1.0" in tag_names, tag_names


def test_extract_detects_rename(gitrepo):
    history = extract(gitrepo, "fix")
    renames = [fc for fc in history.file_changes if fc.change_type == "R"]
    assert any(fc.old_path == "file_a.txt" and fc.path == "file_renamed.txt" for fc in renames), [
        (fc.path, fc.old_path, fc.change_type) for fc in history.file_changes
    ]


def test_no_raw_emails(gitrepo):
    history = extract(gitrepo, "fix")
    for c in history.commits.values():
        assert "***" in c.author_email_norm or c.author_email_norm == "unknown", c.author_email_norm


def test_commit_count(gitrepo):
    history = extract(gitrepo, "fix")
    assert len(history.commits) == 7, len(history.commits)
