import subprocess

from atlas.languages import count_languages


def test_counts_by_language_and_module(tmp_path):
    def w(rel, data):
        f = tmp_path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
    w("addOns/a/src/A.java", b"class A {}\n// x\n")
    w("addOns/a/src/main/javahelp/h.html", b"<h1>x</h1>\n<p>y</p>")   # no trailing newline
    w("addOns/a/src/main/javahelp/img.png", b"\x89PNG\0\0")
    w("README.md", b"hi\n")
    subprocess.run(["git", "-C", str(tmp_path), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "add", "-A"], check=True)
    rows = {(r["module"], r["language"]): (r["files"], r["lines"])
            for r in count_languages("fix", tmp_path, ["addOns/a"])}
    assert rows[("addOns/a", "Java")] == (1, 2)
    assert rows[("addOns/a", "HTML")] == (1, 2)
    assert rows[("addOns/a", "Image")] == (1, 0)
    assert rows[("", "Markdown")] == (1, 1)
