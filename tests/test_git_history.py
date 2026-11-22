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
    from atlas.git_history import EMAIL_RE
    history = extract(gitrepo, "fix")
    for c in history.commits.values():
        assert c.author_email_norm == "unknown" or c.author_email_norm.startswith("u-"), c.author_email_norm
        for text in (c.author_name, c.subject, c.message, c.author_email_norm):
            assert not EMAIL_RE.search(text), text
    c2 = next(c for c in history.commits.values() if c.subject.startswith("c2"))
    assert c2.author_name == "[email redacted]"
    assert "Signed-off-by: Dev <[email redacted]>" in c2.message


def test_contributor_key_is_stable_and_distinct(gitrepo):
    history = extract(gitrepo, "fix")
    keys = {c.author_email_norm for c in history.commits.values()}
    assert len(keys) == 1  # one email address -> one pseudonymous key


def test_commit_count(gitrepo):
    history = extract(gitrepo, "fix")
    assert len(history.commits) == 7, len(history.commits)
