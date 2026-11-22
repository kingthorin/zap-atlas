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
