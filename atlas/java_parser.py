"""Tree-sitter Java syntax extraction.

Emits types (including nested), methods, constructors and fields as symbols with
overload-safe ids and annotations, plus CONTAINS / EXTENDS / IMPLEMENTS / IMPORTS
and CALLS edges.

Evidence levels:
* ``syntactic``: read from source, target not resolved (bare or imported names).
* ``resolved``: facts that follow from Java scoping or declared types: a
  receiver-less call matching exactly one method of the same name and arity in the
  enclosing type, or (in ``atlas.call_resolution``) a call on a receiver whose
  *declared* type is a type in the dataset with exactly one such method.
* ``inferred``: several same-arity overloads match.

A chained call ``a().b()`` is followed through the declared return types of the
methods in the chain (``atlas.call_resolution``); a method's return type is recorded
for that, erased of generics.

Not resolved (counted, never emitted as edges): ``var`` and lambda-typed receivers,
generics, receivers of types outside the dataset, chains that leave the dataset or go
through a generic return type, and anything needing overload resolution beyond name
and arity. Call sites whose
receiver type is known are returned in ``JavaFileResult.call_sites`` for the
cross-file pass.
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
    recv_kind: str = "self"      # self | super | name | field | qualified | type | other
    recv_text: str = ""
    locals: dict | None = None   # variable name -> set of erased declared types in the enclosing method
    chain: tuple = ()            # for recv_kind "chain:<kind>": the calls before this one, innermost first, as (name, arity)


@dataclass
class CallSite:
    """A call whose receiver type is known; resolved against all parsed files later."""
    repo: str
    path: str
    caller: str
    receiver_fqn: str
    name: str
    arity: int
    line: int
    start_at_supers: bool = False
    fallbacks: tuple = ()   # classes from `import static` to try when the receiver type has no such method
    chain: tuple = ()       # (name, arity) of each call between the receiver and this call, innermost first


_PRIMITIVES = {"void", "boolean", "byte", "char", "short", "int", "long", "float", "double"}
_JAVA_LANG = {"Override", "Deprecated", "SuppressWarnings", "FunctionalInterface", "SafeVarargs"}
_LOCAL_DECLS = ("local_variable_declaration", "enhanced_for_statement", "resource",
                "catch_formal_parameter", "formal_parameter", "spread_parameter")


@dataclass
class JavaFileResult:
    path: str
    package: str | None = None
    imports: list[str] = field(default_factory=list)
    symbols: list[Symbol] = field(default_factory=list)
    relationships: list[Relationship] = field(default_factory=list)
    unresolved_calls: int = 0           # chained, untyped or otherwise unresolvable receivers
    calls_total: int = 0
    calls_resolved_same_type: int = 0
    calls_inferred_same_type: int = 0
    call_sites: list[CallSite] = field(default_factory=list)
    # qualified type name -> {"id", "supers": [qualified names], "methods": {name: [(arity, id)]}, "rets": {method id: qualified return type}}
    types: dict = field(default_factory=dict)


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
        for qual, raw in ctx.type_supers.items():
            r.types[qual] = {"id": ctx.type_ids[qual], "supers": [self._fqn(t, ctx) for t in raw],
                             "methods": {n: v for (tq, n), v in ctx.methods.items() if tq == qual},
                             "rets": {sid: self._fqn(t, ctx) for sid, t in ctx.rets.get(qual, {}).items()}}
        return r

    def _fqn(self, name: str, ctx: "_Ctx") -> str:
        """Qualified name for a type used in this file: nested/same-file types first."""
        name = _erase(name)
        if "." not in name and name in ctx.declared:
            return ctx.declared[name]
        return self._resolve_name(name, ctx)

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
        ctx.declared.setdefault(name, qual)
        ctx.type_ids[qual] = sid
        ctx.type_supers[qual] = []
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
                    ctx.type_supers[qual].append(t)
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
                ftype = m.child_by_field_name("type")
                for d in m.children:
                    if d.type == "variable_declarator":
                        fname = _text(d.child_by_field_name("name"))
                        if ftype is not None:
                            ctx.fields.setdefault(qual, {})[fname] = _erase(_text(ftype))
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
        rt = node.child_by_field_name("type")
        if rt is not None and not is_ctor:
            rtype = _erase(_text(rt))
            # primitives, arrays and type variables (T, E, K, V) never name a type in the dataset
            if rtype not in _PRIMITIVES and not rtype.endswith("]") and not re.fullmatch(r"[A-Z][A-Z0-9]?", rtype):
                ctx.rets.setdefault(type_qual, {})[sid] = rtype
        body = node.child_by_field_name("body")
        if body is not None:
            self._collect_calls(body, sid, type_qual, ctx, self._locals(node))

    def _symbol(self, ctx, sid, qual, kind, signature, node) -> Symbol:
        s = Symbol(id=sid, repository=ctx.repo, file=ctx.fid, qualified_name=qual, kind=kind,
                   signature=signature, start_line=node.start_point[0] + 1,
                   end_line=node.end_point[0] + 1, resolution="syntactic")
        mods = next((c for c in node.children if c.type == "modifiers"), None)
        if mods is not None:
            for a in mods.children:
                if a.type in ("marker_annotation", "annotation"):
                    n = a.child_by_field_name("name")
                    if n is not None:
                        nm = _text(n)
                        s.annotations.append(f"java.lang.{nm}" if nm in _JAVA_LANG else self._fqn(nm, ctx))
        ctx.result.symbols.append(s)
        return s

    def _rel(self, ctx, source, target, rtype, evidence, line, confidence=1.0) -> None:
        ctx.result.relationships.append(Relationship(
            source=source, target=target, type=rtype, repository=ctx.repo,
            evidence_type=evidence, confidence=confidence, source_file=ctx.path, source_line=line))

    # -- calls ---------------------------------------------------------------

    def _locals(self, method_node) -> dict:
        """Declared types of parameters and local variables; a name with two types is ambiguous."""
        out: dict[str, set] = {}
        stack = [method_node]
        while stack:
            n = stack.pop()
            if n.type in _TYPE_NODES and n is not method_node:
                continue
            if n.type in _LOCAL_DECLS:
                t = n.child_by_field_name("type")
                if t is None:
                    t = next((c for c in n.named_children if c.type in ("type_identifier", "generic_type",
                             "scoped_type_identifier", "catch_type", "integral_type", "array_type")), None)
                if t is not None and t.type == "catch_type":
                    t = t.named_children[0] if t.named_children else None
                if t is not None and _text(t) != "var":
                    names = [d.child_by_field_name("name") for d in n.named_children if d.type == "variable_declarator"]
                    nm = n.child_by_field_name("name")
                    names = [x for x in names + ([nm] if nm is not None else []) if x is not None]
                    for x in names:
                        out.setdefault(_text(x), set()).add(_erase(_text(t)))
                elif t is not None:  # var: unknown type, make the name unusable
                    for d in n.named_children:
                        nm = d.child_by_field_name("name") if d.type == "variable_declarator" else None
                        if nm is not None:
                            out.setdefault(_text(nm), set()).update({"?1", "?2"})
            stack.extend(n.children)
        return out

    def _receiver(self, obj) -> tuple[str, str]:
        if obj is None or obj.type == "this":
            return "self", ""
        if obj.type == "super":
            return "super", ""
        if obj.type == "identifier":
            return "name", _text(obj)
        if obj.type == "field_access":
            o, f = obj.child_by_field_name("object"), obj.child_by_field_name("field")
            if o is not None and o.type == "this" and f is not None:
                return "field", _text(f)
            return "qualified", _text(obj)
        if obj.type == "scoped_identifier":
            return "qualified", _text(obj)
        if obj.type == "object_creation_expression":
            t = obj.child_by_field_name("type")
            return ("type", _text(t)) if t is not None else ("other", "")
        return "other", ""

    def _collect_calls(self, node, caller: str, type_qual: str, ctx: "_Ctx", locals_: dict) -> None:
        stack = [node]
        while stack:
            n = stack.pop()
            if n.type in _TYPE_NODES:
                continue  # nested/local types are visited as members, not as part of this method
            if n.type == "method_invocation":
                args = n.child_by_field_name("arguments")
                obj, chain = n.child_by_field_name("object"), []
                while obj is not None and obj.type == "method_invocation":     # a().b().c(): walk down to the first receiver
                    a = obj.child_by_field_name("arguments")
                    chain.append((_text(obj.child_by_field_name("name")), len(a.named_children) if a is not None else 0))
                    obj = obj.child_by_field_name("object")
                kind, text = self._receiver(obj)
                if chain:
                    kind = f"chain:{kind}"
                ctx.calls.append(_Call(caller, type_qual, _text(n.child_by_field_name("name")),
                                       len(args.named_children) if args is not None else 0,
                                       n.start_point[0] + 1, kind, text, locals_, tuple(reversed(chain))))
            stack.extend(n.children)

    def _field_type(self, type_qual: str, name: str, ctx: "_Ctx") -> str | None:
        q = type_qual
        while q:
            t = ctx.fields.get(q, {}).get(name)
            if t:
                return t
            q = q.rpartition(".")[0] if q in ctx.type_ids and "." in q else ""
        return None

    def _resolve_calls(self, ctx: "_Ctx") -> None:
        r, seen = ctx.result, set()

        def edge(caller, target, evidence, line, conf=1.0):
            if (caller, target) not in seen:
                seen.add((caller, target))
                self._rel(ctx, caller, target, "CALLS", evidence, line, conf)

        for c in ctx.calls:
            r.calls_total += 1
            if c.recv_kind in ("self", "super"):
                cands = [] if c.recv_kind == "super" else \
                    [sid for arity, sid in ctx.methods.get((c.type_qual, c.name), []) if arity == c.arity]
                if len(cands) == 1:
                    r.calls_resolved_same_type += 1
                    edge(c.caller, cands[0], "resolved", c.line)
                elif cands:
                    r.calls_inferred_same_type += 1
                    for sid in cands:
                        edge(c.caller, sid, "inferred", c.line, 1 / len(cands))
                else:  # maybe inherited or statically imported: finish in the cross-file pass
                    static = tuple(ctx.static_explicit.get(c.name, [])) or tuple(ctx.static_wild)
                    r.call_sites.append(CallSite(ctx.repo, ctx.path, c.caller, c.type_qual, c.name, c.arity,
                                                 c.line, start_at_supers=True, fallbacks=static))
                continue
            kind, chain = c.recv_kind, ()
            if kind.startswith("chain:"):
                kind, chain = kind[len("chain:"):], c.chain
            recv_type = None
            if kind == "self" and chain:
                recv_type = c.type_qual                 # this.a().b(): the chain starts at the enclosing type
            elif kind == "name":
                declared = (c.locals or {}).get(c.recv_text)
                if declared is not None:
                    recv_type = next(iter(declared)) if len(declared) == 1 and not next(iter(declared)).startswith("?") else None
                else:
                    recv_type = self._field_type(c.type_qual, c.recv_text, ctx) or \
                        (c.recv_text if c.recv_text[:1].isupper() else None)   # static call on a type name
            elif kind == "field":
                recv_type = self._field_type(c.type_qual, c.recv_text, ctx)
            elif kind in ("type", "qualified"):
                recv_type = c.recv_text
            if recv_type is None:
                r.unresolved_calls += 1
            else:
                r.call_sites.append(CallSite(ctx.repo, ctx.path, c.caller, self._fqn(recv_type, ctx), c.name,
                                             c.arity, c.line, chain=chain))


class _Ctx:
    def __init__(self, repo: str, fid: str, path: str, result: JavaFileResult) -> None:
        self.repo, self.fid, self.path, self.result = repo, fid, path, result
        self.methods: dict[tuple[str, str], list[tuple[int, str]]] = {}
        self.calls: list[_Call] = []
        self.rets: dict[str, dict[str, str]] = {}      # type -> {method id: erased return type}
        self.top_level: list[tuple[str, str]] = []
        self.declared: dict[str, str] = {}      # simple name -> qualified name, types declared in this file
        self.type_ids: dict[str, str] = {}
        self.type_supers: dict[str, list[str]] = {}
        self.fields: dict[str, dict[str, str]] = {}
        self.static_explicit: dict[str, list[str]] = {}   # member name -> classes (import static a.B.m)
        self.static_wild: list[str] = []                  # classes (import static a.B.*)
        for imp in result.imports:
            if imp.startswith("static "):
                full = imp[len("static "):].strip()
                cls, _, member = full.rpartition(".")
                if member == "*":
                    self.static_wild.append(cls)
                elif cls:
                    self.static_explicit.setdefault(member, []).append(cls)
