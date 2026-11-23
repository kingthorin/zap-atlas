"""Tests for the Tree-sitter Java parser (syntactic extraction)."""
from atlas.java_parser import JavaParser


def test_parses_class_inheritance_and_call():
    source = (
        "package org.zaproxy;\n"
        "import java.util.List;\n"
        "public class Hello extends Base implements Runnable {\n"
        "  public void run() {\n"
        "    helper();\n"
        "  }\n"
        "  private void helper() {}\n"
        "}\n"
        "interface Base {}\n"
    )
    result = JavaParser().parse_file("fix", "sha1", "org/zaproxy/Hello.java", source)
    quals = {s.qualified_name for s in result.symbols}
    assert "org.zaproxy.Hello" in quals, quals
    assert "org.zaproxy.Base" in quals, quals
    kinds = {s.kind for s in result.symbols}
    assert "class" in kinds, kinds
    assert "interface" in kinds, kinds
    # imports
    assert "java.util.List" in result.imports
    # CALLS relationship present
    call_types = {r.type for r in result.relationships}
    assert "CALLS" in call_types, call_types
    assert "EXTENDS" in call_types
    assert "IMPLEMENTS" in call_types


def test_symbol_ids_unique_and_repo_qualified():
    source = "package org.zaproxy;\npublic class Hello {}\n"
    result = JavaParser().parse_file("repoA", "sha", "x/Hello.java", source)
    for s in result.symbols:
        assert s.id.startswith("symbol:repoA:"), s.id
        assert s.resolution == "syntactic"


SOURCE = '''package org.zaproxy;
import java.util.List;
import org.other.Base;
import static org.other.Util.helper;
import org.other.*;
public class Outer extends Base implements Runnable, Comparable<Outer> {
  private int count, total;
  public Outer() {}
  public void run() { work(1); work("a", 2); other(); list.size(); }
  void work(int a) {}
  void work(String s, int n) {}
  void work(long x) { work(1); }
  static class Inner { void go() {} }
  enum Mode { A, B; void m() {} }
}
interface Api extends Runnable {}
'''


def _parse():
    return JavaParser().parse_file("fix", "sha1", "org/zaproxy/Outer.java", SOURCE)


def test_members_nested_types_and_overload_safe_ids():
    r = _parse()
    ids = {s.id for s in r.symbols}
    assert "symbol:fix:org.zaproxy.Outer" in ids
    assert "symbol:fix:org.zaproxy.Outer.Inner" in ids
    assert "symbol:fix:org.zaproxy.Outer.Mode" in ids
    assert "symbol:fix:org.zaproxy.Outer#work(int)" in ids
    assert "symbol:fix:org.zaproxy.Outer#work(String,int)" in ids
    assert "symbol:fix:org.zaproxy.Outer#Outer()" in ids  # constructor
    assert "symbol:fix:org.zaproxy.Outer#count" in ids and "symbol:fix:org.zaproxy.Outer#total" in ids
    assert "symbol:fix:org.zaproxy.Outer.Inner#go()" in ids
    assert len(ids) == len(r.symbols)


def test_type_references_and_imports_are_syntactic_and_use_imports():
    r = _parse()
    rels = {(x.type, x.target) for x in r.relationships}
    assert ("EXTENDS", "symbol:fix:org.other.Base") in rels          # via import
    assert ("IMPLEMENTS", "symbol:fix:org.zaproxy.Runnable") in rels  # same package guess
    assert ("IMPLEMENTS", "symbol:fix:org.zaproxy.Comparable") in rels  # generics erased
    assert ("EXTENDS", "symbol:fix:org.zaproxy.Runnable") in rels      # interface extends
    assert ("IMPORTS", "symbol:fix:java.util.List") in rels
    assert not any(t == "IMPORTS" and ("*" in x or "helper" in x) for t, x in rels)
    assert all(x.evidence_type == "syntactic" for x in r.relationships if x.type in ("EXTENDS", "IMPLEMENTS", "IMPORTS"))


def test_calls_resolved_inferred_or_dropped():
    r = _parse()
    calls = [(x.source, x.target, x.evidence_type) for x in r.relationships if x.type == "CALLS"]
    run = "symbol:fix:org.zaproxy.Outer#run()"
    assert (run, "symbol:fix:org.zaproxy.Outer#work(String,int)", "resolved") in calls
    # work(1): two one-arg overloads -> inferred to both, never "resolved"
    one_arg = {t: e for s, t, e in calls if s == run and "work(int)" in t or "work(long)" in t and s == run}
    assert set(one_arg.values()) == {"inferred"} and len(one_arg) == 2
    # other() and list.size() have no declaration here -> counted, not emitted
    assert not any("other" in t or "size" in t for _, t, _ in calls)
    assert r.unresolved_calls == 1  # list.size(): receiver type unknown
    # other() is not declared in Outer: handed to the cross-file pass, which looks in supertypes
    assert any(c.name == "other" and c.start_at_supers and c.receiver_fqn == "org.zaproxy.Outer" for c in r.call_sites)


def test_c_style_array_params_do_not_collide():
    src = "class A { void p(char c) {} void p(char s[]) {} void q(String... xs) {} void q(int[] a) {} }"
    r = JavaParser().parse_file("fix", "sha", "A.java", src)
    ids = [s.id for s in r.symbols]
    assert len(ids) == len(set(ids)), ids
    assert "symbol:fix:A#p(char[])" in ids and "symbol:fix:A#q(String...)" in ids


def test_imports_hang_off_the_primary_type_not_the_file_node():
    src = "package p;\nimport a.B;\nclass Other {}\npublic class Main {}\n"
    r = JavaParser().parse_file("fix", "sha", "p/Main.java", src)
    imp = [x for x in r.relationships if x.type == "IMPORTS"]
    assert [x.source for x in imp] == ["symbol:fix:p.Main"]


def test_annotations_are_recorded_with_qualified_names():
    src = ("package p;\nimport org.x.Custom;\n@Deprecated\npublic class A {\n"
           "  @Override @Custom(1) public String toString() { return \"\"; }\n  @Deprecated int f;\n}\n")
    r = JavaParser().parse_file("fix", "sha", "p/A.java", src)
    ann = {s.qualified_name: s.annotations for s in r.symbols}
    assert ann["p.A"] == ["java.lang.Deprecated"]
    assert ann["p.A#toString()"] == ["java.lang.Override", "org.x.Custom"]
    assert ann["p.A#f"] == ["java.lang.Deprecated"]
