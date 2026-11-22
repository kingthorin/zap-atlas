"""Tree-sitter Java syntax extraction (syntactic relationships only)."""

from __future__ import annotations

from dataclasses import dataclass, field

from tree_sitter import Parser, Tree

from atlas.schema import Symbol, Relationship, symbol_id, file_id


@dataclass
class JavaCall:
    caller_symbol: str | None
    callee_text: str
    line: int


@dataclass
class JavaFileResult:
    path: str
    package: str | None = None
    imports: list[str] = field(default_factory=list)
    symbols: list[Symbol] = field(default_factory=list)
    calls: list[JavaCall] = field(default_factory=list)
    relationships: list[Relationship] = field(default_factory=list)


class JavaParser:
    def __init__(self) -> None:
        from tree_sitter import Language, Parser
        import tree_sitter_java
        self.language = Language(tree_sitter_java.language())
        self.parser = Parser()
        self.parser.language = self.language

    def parse_file(self, repo: str, sha: str, path: str, source: str) -> JavaFileResult:
        tree = self.parser.parse(bytes(source, "utf8"))
        r = JavaFileResult(path=path)
        r.package = self._pkg(tree)
        r.imports = self._imports(tree)
        r.symbols, r.relationships = self._types(tree, repo, sha, path, r)
        r.calls = self._calls(tree, repo, r)
        r.relationships += self._call_rels(repo, path, r)
        return r

    def _pkg(self, tree: Tree) -> str | None:
        for n in tree.root_node.children:
            if n.type == "package_declaration":
                for c in n.children:
                    if c.type == "scoped_identifier":
                        return c.text.decode("utf8", "replace")
        return None

    def _imports(self, tree: Tree) -> list[str]:
        out = []
        for n in tree.root_node.children:
            if n.type == "import_declaration":
                name = n.text.decode("utf8", "replace")
                name = name.replace("import", "").replace("static", "").replace(";", "").strip()
                if name:
                    out.append(name)
        return out

    def _types(self, tree, repo, sha, path, result):
        syms, rels = [], []
        for n in tree.root_node.children:
            if n.type in ("class_declaration", "interface_declaration",
                          "enum_declaration", "record_declaration"):
                s, rs = self._type(n, repo, sha, path, result)
                if s:
                    syms.append(s); rels += rs
        return syms, rels

    def _type(self, node, repo, sha, path, result):
        name = None
        for c in node.children:
            if c.type == "identifier":
                name = c.text.decode("utf8", "replace"); break
        if not name:
            return None, []
        qual = f"{result.package}.{name}" if result.package else name
        sym = Symbol(id=symbol_id(repo, qual), repository=repo,
                     file=file_id(repo, sha, path), qualified_name=qual,
                     kind=node.type.replace("_declaration", ""), signature=name,
                     start_line=node.start_point[0] + 1,
                     end_line=node.end_point[0] + 1, resolution="syntactic")
        rels = [Relationship(source=file_id(repo, sha, path), target=sym.id,
                             type="CONTAINS", repository=repo,
                             evidence_type="syntactic", source_file=path,
                             source_line=sym.start_line)]
        for c in node.children:
            if c.type == "superclass":
                for cc in c.children:
                    if cc.type == "type_identifier":
                        rels.append(Relationship(source=sym.id,
                            target=symbol_id(repo, cc.text.decode("utf8","replace")),
                            type="EXTENDS", repository=repo, evidence_type="syntactic",
                            source_file=path, source_line=sym.start_line))
            if c.type == "super_interfaces":
                for cc in c.children:
                    if cc.type in ("type_list", "super_interfaces"):
                        for ccc in cc.children:
                            if ccc.type == "type_identifier":
                                rels.append(Relationship(source=sym.id,
                                    target=symbol_id(repo, ccc.text.decode("utf8","replace")),
                                    type="IMPLEMENTS", repository=repo,
                                    evidence_type="syntactic", source_file=path,
                                    source_line=sym.start_line))
        return sym, rels

    def _calls(self, tree, repo, result):
        calls = []
        # Stack of (type_qual, method_name) for the enclosing context.
        ctx = [None, None]  # [type_qual, method_name]

        def walk(n):
            # Enter a top-level type declaration -> set type context.
            if n.type in ("class_declaration", "interface_declaration",
                          "enum_declaration", "record_declaration"):
                name = None
                for c in n.children:
                    if c.type == "identifier":
                        name = c.text.decode("utf8", "replace"); break
                tq = f"{result.package}.{name}" if (result.package and name) else name
                saved_tq, saved_m = ctx[0], ctx[1]
                ctx[0], ctx[1] = tq, None
                for c in n.children:
                    walk(c)
                ctx[0], ctx[1] = saved_tq, saved_m
                return

            if n.type == "method_invocation":
                for c in n.children:
                    if c.type == "identifier":
                        callee = c.text.decode("utf8", "replace")
                        caller = None
                        if ctx[0] and ctx[1]:
                            caller = symbol_id(repo, f"{ctx[0]}#{ctx[1]}")
                        calls.append(JavaCall(caller, callee,
                                              n.start_point[0] + 1))
                        break
                # do not recurse into arguments' identifiers as calls
                for c in n.children:
                    if c.type == "argument_list":
                        continue
                    walk(c)
                return

            if n.type == "method_declaration":
                name = None
                for c in n.children:
                    if c.type == "identifier":
                        name = c.text.decode("utf8", "replace"); break
                saved_m = ctx[1]
                ctx[1] = name
                for c in n.children:
                    walk(c)
                ctx[1] = saved_m
                return

            for c in n.children:
                walk(c)

        walk(tree.root_node)
        return calls

    def _call_rels(self, repo, path, result):
        rels = []
        for call in result.calls:
            if call.caller_symbol:
                rels.append(Relationship(source=call.caller_symbol,
                    target=symbol_id(repo, call.callee_text), type="CALLS",
                    repository=repo, evidence_type="syntactic",
                    source_file=path, source_line=call.line))
        return rels

