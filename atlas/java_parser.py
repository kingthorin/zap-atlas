"""Tree-sitter Java syntax extraction.

Emits types (including nested), methods, constructors and fields as symbols with
overload-safe ids, plus CONTAINS / EXTENDS / IMPLEMENTS / IMPORTS / CALLS edges.

Evidence levels:
* ``syntactic``: read from source, target not resolved (bare or imported names).
* ``resolved``: only for facts that follow from Java scoping within the file
  (a receiver-less call matching exactly one method of the same name and arity
  declared in the enclosing type). Cross-file resolution happens later, against
  the whole symbol table.
* ``inferred``: an unqualified call that matches several same-arity overloads.

Calls that cannot be tied to a declaration in the same type are not emitted as
edges; they are only counted in ``JavaFileResult.unresolved_calls``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from tree_sitter import Tree

from atlas.schema import Relationship, Symbol, file_id, symbol_id

_TYPE_NODES = ("class_declaration", "interface_declaration",
               "enum_declaration", "record_declaration", "annotation_type_declaration")


def _text(n) -> str:
    return n.text.decode("utf8", "replace")


def _erase(type_text: str) -> str:
    """Drop generics and whitespace: ``Map<String, List<X>>`` -> ``Map``."""
    prev = None
    while prev != type_text:
        prev = type_text
        type_text = re.sub(r"<[^<>]*>", "", type_text)
    return re.sub(r"\s+", "", type_text)


@dataclass
class _Call:
    caller: str
    type_qual: str
    name: str
    arity: int
    line: int


@dataclass
class JavaFileResult:
    path: str
    package: str | None = None
    imports: list[str] = field(default_factory=list)
    symbols: list[Symbol] = field(default_factory=list)
    relationships: list[Relationship] = field(default_factory=list)
    unresolved_calls: int = 0


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
        fid = file_id(repo, sha, path)
        ctx = _Ctx(repo, fid, path, r)
        for n in tree.root_node.children:
            if n.type in _TYPE_NODES:
                self._type(n, None, ctx)
        # Imports are file-level in Java; attribute them to the file's primary type
        # (the one named like the file, else the first), which is a real symbol.
        if ctx.top_level:
            primary = next((sid for sid, name in ctx.top_level if name == Path(path).stem), ctx.top_level[0][0])
            for imp in r.imports:
                if not imp.endswith("*") and not imp.startswith("static "):
                    r.relationships.append(Relationship(
                        source=primary, target=symbol_id(repo, imp), type="IMPORTS", repository=repo,
                        evidence_type="syntactic", source_file=path))
        self._resolve_calls(ctx)
        return r

    # -- file level -------------------------------------------------------

    def _pkg(self, tree: Tree) -> str | None:
        for n in tree.root_node.children:
            if n.type == "package_declaration":
                for c in n.children:
                    if c.type in ("scoped_identifier", "identifier"):
                        return _text(c)
        return None

    def _imports(self, tree: Tree) -> list[str]:
        out = []
        for n in tree.root_node.children:
            if n.type == "import_declaration":
                name = re.sub(r"^import\s+|;\s*$", "", _text(n)).strip()
                if name:
                    out.append(name)
        return out

    # -- types and members --------------------------------------------------

    def _resolve_name(self, name: str, ctx: "_Ctx") -> str:
        """Best-effort fully-qualified candidate for a type name used in this file."""
        name = _erase(name)
        if "." in name:
            return name
        for imp in ctx.result.imports:
            if imp.endswith("." + name):
                return imp
        if ctx.result.package:
            return f"{ctx.result.package}.{name}"
        return name

    def _type(self, node, outer: str | None, ctx: "_Ctx") -> None:
        name_node = node.child_by_field_name("name")
        if name_node is None:
            return
        name = _text(name_node)
        base = outer or ctx.result.package
        qual = f"{base}.{name}" if base else name
        sid = symbol_id(ctx.repo, qual)
        sym = self._symbol(ctx, sid, qual, node.type.replace("_declaration", ""), name, node)
        if not outer:
            ctx.top_level.append((sid, name))
        parent = symbol_id(ctx.repo, outer) if outer else ctx.fid
        self._rel(ctx, parent, sid, "CONTAINS", "resolved" if outer else "syntactic", sym.start_line)

        for c in node.children:
            if c.type in ("superclass", "extends_interfaces", "super_interfaces",
                          "permits"):
                kind = "IMPLEMENTS" if c.type == "super_interfaces" else "EXTENDS"
                if c.type == "permits":
                    continue
                for t in self._type_names(c):
                    self._rel(ctx, sid, symbol_id(ctx.repo, self._resolve_name(t, ctx)),
                              kind, "syntactic", sym.start_line)

        body = node.child_by_field_name("body")
        if body is None:
            return
        members = []
        for c in body.children:
            if c.type == "enum_body_declarations":
                members += c.children
            else:
                members.append(c)
        for m in members:
            if m.type in _TYPE_NODES:
                self._type(m, qual, ctx)
            elif m.type in ("method_declaration", "constructor_declaration"):
                self._method(m, qual, name, sid, ctx)
            elif m.type == "field_declaration":
                for d in m.children:
                    if d.type == "variable_declarator":
                        fname = _text(d.child_by_field_name("name"))
                        fsid = symbol_id(ctx.repo, qual, fname)
                        s = self._symbol(ctx, fsid, f"{qual}#{fname}", "field", fname, m)
                        self._rel(ctx, sid, fsid, "CONTAINS", "resolved", s.start_line)

    def _type_names(self, node) -> list[str]:
        out = []
        for c in node.children:
            if c.type in ("type_identifier", "generic_type", "scoped_type_identifier"):
                out.append(_text(c))
            elif c.type == "type_list":
                out += self._type_names(c)
        return out

    def _method(self, node, type_qual: str, type_name: str, type_sid: str, ctx: "_Ctx") -> None:
        is_ctor = node.type == "constructor_declaration"
        name = _text(node.child_by_field_name("name"))
        params = node.child_by_field_name("parameters")
        ptypes = []
        if params is not None:
            for p in params.named_children:
                t = p.child_by_field_name("type")
                if t is None and p.type == "spread_parameter":  # varargs has no "type" field
                    t = next((c for c in p.named_children
                              if c.type not in ("modifiers", "variable_declarator")), None)
                if t is not None:
                    dims = p.child_by_field_name("dimensions")  # C-style: String s[]
                    ptypes.append(_erase(_text(t)) + (_erase(_text(dims)) if dims is not None else "")
                                  + ("..." if p.type == "spread_parameter" else ""))
        sig = f"{name}({','.join(ptypes)})"
        sid = symbol_id(ctx.repo, type_qual, sig)
        s = self._symbol(ctx, sid, f"{type_qual}#{sig}", "constructor" if is_ctor else "method", sig, node)
        self._rel(ctx, type_sid, sid, "CONTAINS", "resolved", s.start_line)
        ctx.methods.setdefault((type_qual, name), []).append((len(ptypes), sid))
        body = node.child_by_field_name("body")
        if body is not None:
            self._collect_calls(body, sid, type_qual, ctx)

    def _symbol(self, ctx, sid, qual, kind, signature, node) -> Symbol:
        s = Symbol(id=sid, repository=ctx.repo, file=ctx.fid, qualified_name=qual, kind=kind,
                   signature=signature, start_line=node.start_point[0] + 1,
                   end_line=node.end_point[0] + 1, resolution="syntactic")
        ctx.result.symbols.append(s)
        return s

    def _rel(self, ctx, source, target, rtype, evidence, line, confidence=1.0) -> None:
        ctx.result.relationships.append(Relationship(
            source=source, target=target, type=rtype, repository=ctx.repo,
            evidence_type=evidence, confidence=confidence, source_file=ctx.path, source_line=line))

    # -- calls ---------------------------------------------------------------

    def _collect_calls(self, node, caller: str, type_qual: str, ctx: "_Ctx") -> None:
        stack = [node]
        while stack:
            n = stack.pop()
            if n.type in _TYPE_NODES:
                continue  # nested/local types are visited as members, not as part of this method
            if n.type == "method_invocation":
                obj = n.child_by_field_name("object")
                if obj is None or obj.type == "this":
                    args = n.child_by_field_name("arguments")
                    ctx.calls.append(_Call(caller, type_qual, _text(n.child_by_field_name("name")),
                                           len(args.named_children) if args is not None else 0,
                                           n.start_point[0] + 1))
                else:
                    ctx.result.unresolved_calls += 1
            stack.extend(n.children)

    def _resolve_calls(self, ctx: "_Ctx") -> None:
        for c in ctx.calls:
            cands = [sid for arity, sid in ctx.methods.get((c.type_qual, c.name), []) if arity == c.arity]
            if not cands:
                ctx.result.unresolved_calls += 1
            elif len(cands) == 1:
                self._rel(ctx, c.caller, cands[0], "CALLS", "resolved", c.line)
            else:
                for sid in cands:
                    self._rel(ctx, c.caller, sid, "CALLS", "inferred", c.line, 1 / len(cands))


class _Ctx:
    def __init__(self, repo: str, fid: str, path: str, result: JavaFileResult) -> None:
        self.repo, self.fid, self.path, self.result = repo, fid, path, result
        self.methods: dict[tuple[str, str], list[tuple[int, str]]] = {}
        self.calls: list[_Call] = []
        self.top_level: list[tuple[str, str]] = []
