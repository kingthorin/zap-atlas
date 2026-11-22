import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

_ENV = {
    "GIT_AUTHOR_NAME": "Test User", "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test User", "GIT_COMMITTER_EMAIL": "test@example.com",
}


def _git(repo, *args, when=None, author=None):
    env = {**os.environ, **_ENV}
    if author:
        env["GIT_AUTHOR_NAME"] = author
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

    def commit(msg, *files, author=None, body=None):
        n[0] += 1
        for rel, text in files:
            f = r / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(text)
        _git(r, "add", "-A")
        extra = ["-m", body] if body else []
        _git(r, "commit", "-q", "-m", msg, *extra, when=f"2024-01-0{n[0]}T00:00:00+0000", author=author)

    _git(r, "init", "-q", "-b", "main")
    commit("c1 add file_a", ("file_a.txt", "a\n"))
    commit("c2 add file_b", ("file_b.txt", "b\n"), author="dev@example.org",
           body="Signed-off-by: Dev <dev@example.org>")
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


@pytest.fixture
def ecosystem_repo(tmp_path):
    """Gradle multi-project fixture: two add-ons (one depends on the other), help with a
    locale dir, a non-add-on module, and a malformed build file."""
    def w(rel, text):
        f = tmp_path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)

    w("addOns/alpha/alpha.gradle.kts", '''
zapAddOn {
    addOnName.set("Alpha add-on")
    addOnStatus.set(AddOnStatus.RELEASE)
    manifest {
        author.set("Someone")
        url.set("https://example.org/alpha")
        dependencies { addOns { register("beta") { version.set(">= 1") }
                                register("missing") } }
        extensions { register("org.example.ExtensionAlpha") { classnames { allowed.set(listOf("x")) } } }
    }
}''')
    w("addOns/alpha/src/main/javahelp/org/example/help/contents/alpha.html",
      '<html><body><h1>Alpha</h1><a name="top"></a><h2 id="sec">Sec</h2><a href="x.html">x</a></body></html>')
    w("addOns/alpha/src/main/javahelp/org/example/help_de_DE/contents/alpha.html", "<h1>Alpha DE</h1>")
    w("addOns/beta/beta.gradle.kts", 'zapAddOn { addOnName.set("Beta") }')
    w("addOns/broken/broken.gradle.kts", "zapAddOn { addOnName.set(\"unterminated")
    w("addOns/plain/plain.gradle.kts", "// no add-on block")
    w("zap/zap.gradle.kts", "plugins {}")
    return tmp_path
