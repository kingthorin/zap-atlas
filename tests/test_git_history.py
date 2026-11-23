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


def test_line_counts_for_added_and_renamed_files(gitrepo):
    history = extract(gitrepo, "fix")
    hello = next(fc for fc in history.file_changes if fc.path.endswith("Hello.java"))
    assert (hello.additions, hello.deletions) == (5, 0)
    rename = next(fc for fc in history.file_changes if fc.change_type == "R")
    assert (rename.additions, rename.deletions) == (0, 0)          # a pure rename changes no lines
    assert not [fc for fc in history.file_changes if len(history.commits[fc.sha].parents) > 1]   # merges have no diff


def test_line_counts_for_edits_edited_renames_and_binary_files(tmp_path):
    import subprocess
    def git(*a):
        subprocess.run(["git", *a], cwd=tmp_path, check=True, capture_output=True,
                       env={**os.environ, "GIT_AUTHOR_NAME": "A", "GIT_AUTHOR_EMAIL": "a@b.c", "GIT_COMMITTER_NAME": "A", "GIT_COMMITTER_EMAIL": "a@b.c"})
    git("init", "-q", "-b", "main")
    (tmp_path / "t.txt").write_text("".join(f"line {i}\n" for i in range(10)))
    (tmp_path / "b.bin").write_bytes(bytes(range(256)) * 4)
    git("add", "-A"); git("commit", "-q", "-m", "one")
    (tmp_path / "t.txt").write_text("".join(f"line {i}\n" for i in range(10) if i != 3) + "extra\n")   # -1 +1
    (tmp_path / "b.bin").write_bytes(bytes(reversed(range(256))) * 4)
    git("add", "-A"); git("commit", "-q", "-m", "two")
    git("mv", "t.txt", "u.txt")
    (tmp_path / "u.txt").write_text((tmp_path / "u.txt").read_text() + "more\n")                        # +1 after the rename
    git("add", "-A"); git("commit", "-q", "-m", "three")
    changes = {(history_fc.path, history_fc.change_type): (history_fc.additions, history_fc.deletions)
               for history_fc in extract(tmp_path, "t").file_changes}
    assert changes[("t.txt", "A")] == (10, 0) and changes[("b.bin", "A")] == (0, 0)
    assert changes[("t.txt", "M")] == (1, 1) and changes[("b.bin", "M")] == (0, 0)    # binary files count as 0
    assert changes[("u.txt", "R")] == (1, 0)
