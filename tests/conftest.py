import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

_ENV = {
    "GIT_AUTHOR_NAME": "Test User", "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test User", "GIT_COMMITTER_EMAIL": "test@example.com",
}


def _git(repo, *args, when=None):
    env = {**os.environ, **_ENV}
    if when:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = when
    subprocess.run(["git", "-C", str(repo), *args], check=True, env=env,
                   stdout=subprocess.DEVNULL)


@pytest.fixture(scope="session")
def gitrepo(tmp_path_factory):
    """Throwaway repo: 7 commits, one merge, branch 'feature', tag v1.0, a rename, a Java file."""
    r = tmp_path_factory.mktemp("fixtures") / "gitrepo"
    r.mkdir()
    n = [0]

    def commit(msg, *files):
        n[0] += 1
        for rel, text in files:
            f = r / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(text)
        _git(r, "add", "-A")
        _git(r, "commit", "-q", "-m", msg, when=f"2024-01-0{n[0]}T00:00:00+0000")

    _git(r, "init", "-q", "-b", "main")
    commit("c1 add file_a", ("file_a.txt", "a\n"))
    commit("c2 add file_b", ("file_b.txt", "b\n"))
    _git(r, "tag", "v1.0")
    _git(r, "checkout", "-q", "-b", "feature")
    commit("c3 add file_c", ("file_c.txt", "c\n"))
    _git(r, "checkout", "-q", "main")
    commit("c4 add file_d", ("file_d.txt", "d\n"))
    n[0] += 1
    _git(r, "merge", "-q", "--no-ff", "feature", "-m", "c5 merge feature into main",
         when=f"2024-01-0{n[0]}T00:00:00+0000")
    _git(r, "mv", "file_a.txt", "file_renamed.txt")
    commit("c6 rename file_a")
    commit("c7 add Hello.java", ("src/org/zaproxy/Hello.java",
           "package org.zaproxy;\npublic class Hello {\n"
           "  public void run() { helper(); }\n  private void helper() {}\n}\n"))
    return r
