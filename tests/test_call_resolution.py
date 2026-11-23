from atlas.call_resolution import resolve_call_sites
from atlas.java_parser import JavaParser


def _run(files):
    """files: {path: source}; returns (edges, stats, per-file results)."""
    parser = JavaParser()
    results = [parser.parse_file("fix", "sha", p, src) for p, src in files.items()]
    types, sites = {}, []
    for r in results:
        types.update(r.types)
        sites += r.call_sites
    edges, stats = resolve_call_sites(types, sites)
    return edges, stats, results


def _calls(edges):
    return {(e.source.split("#")[-1], e.target.split("fix:")[-1], e.evidence_type) for e in edges}


FILES = {
    "a/Base.java": "package a;\npublic class Base { public void inherited() {} public void dup(int x) {} }\n",
    "a/Util.java": "package a;\npublic class Util { public static void helper(String s) {} }\n",
    "b/Svc.java": '''package b;
import a.Base;
import a.Util;
public class Svc extends Base {
  private Base base;
  void run(Base param) {
    Util.helper("x");        // static call on an imported type
    base.inherited();        // field of declared type Base
    param.dup(1);            // parameter
    Base local = param; local.inherited();
    inherited();             // inherited, receiver-less
    super.dup(2);            // via super
    this.base.inherited();   // this.field
    new Base().inherited();  // object creation
    param.chain().x();       // chained: not resolved
    var v = param; v.dup(3); // var: not resolved
    java.util.List<String> l = null; l.size();  // type outside the dataset
  }
}
''',
}


def test_calls_resolve_through_declared_types_and_supertypes():
    edges, stats, results = _run(FILES)
    got = _calls(edges)
    run = "run(Base)"
    assert (run, "a.Util#helper(String)", "resolved") in got
    assert (run, "a.Base#inherited()", "resolved") in got
    assert (run, "a.Base#dup(int)", "resolved") in got
    assert stats["receiver_type_outside_dataset"] == 1          # l.size()
    assert stats["resolved"] >= 6
    # one edge per (caller, target) even though inherited() is called four times
    assert sum(1 for e in edges if e.target.endswith("Base#inherited()")) == 1


def test_chained_and_var_receivers_are_counted_not_guessed():
    _, _, results = _run(FILES)
    svc = next(r for r in results if r.path == "b/Svc.java")
    # .x() on a call result and v.dup(3) on a `var`; param.chain() has a known receiver type and is
    # counted by the cross-file pass as "type known, method not found".
    assert svc.unresolved_calls == 2


def test_ambiguous_overloads_are_inferred():
    files = {"a/T.java": "package a;\nclass T { void f(int a) {} void f(long a) {} }\n",
             "a/U.java": "package a;\nclass U { void g(T t) { t.f(1); } }\n"}
    edges, stats, _ = _run(files)
    assert stats["inferred"] == 1 and {e.evidence_type for e in edges} == {"inferred"} and len(edges) == 2


def test_duplicate_type_names_are_not_resolved():
    parser = JavaParser()
    r1 = parser.parse_file("fix", "s", "x/A.java", "package a;\nclass A { void m() {} }\n")
    types = dict(r1.types)
    types["a.A"] = {**types["a.A"], "ambiguous": True}
    r2 = parser.parse_file("fix", "s", "x/B.java", "package a;\nclass B { void g(A a) { a.m(); } }\n")
    edges, stats = resolve_call_sites({**types, **r2.types}, r2.call_sites)
    assert edges == [] and stats["receiver_type_outside_dataset"] == 1


def test_statically_imported_members_resolve_or_count_as_external():
    files = {"u/Util.java": "package u;\npublic class Util { public static void helper(int a) {} }\n",
             "u/Use.java": ("package u2;\nimport static u.Util.helper;\nimport static org.junit.Assert.*;\n"
                            "class Use { void t() { helper(1); assertThat(1); } }\n")}
    edges, stats, _ = _run(files)
    assert {(e.target.split("fix:")[-1], e.evidence_type) for e in edges} == {("u.Util#helper(int)", "resolved")}
    assert stats["receiver_type_outside_dataset"] == 1   # assertThat -> org.junit.Assert is not in the dataset
    assert stats["type_in_dataset_method_not_found"] == 0
