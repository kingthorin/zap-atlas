"""Resolve call sites against the declared types of every parsed file.

A call is ``resolved`` when its receiver's declared type is in the dataset and has
exactly one method of that name and arity (searching supertypes that are also in
the dataset); ``inferred`` when several match. No overload resolution beyond arity,
no generics, no ``var``: those stay out of the graph and are counted.

A chained call ``a().b()`` is followed step by step: each inner call must resolve to a method in the dataset,
and its declared return type (erased of generics) is the receiver of the next step. Overloads are followed only
when all of them declare the same return type. The result is ``resolved`` when every step had exactly one
candidate, else ``inferred``.
"""

from __future__ import annotations

from atlas.java_parser import CallSite
from atlas.schema import Relationship


def _find(types: dict, fqn: str, name: str, arity: int, skip_self: bool, seen: set) -> list[str] | None:
    """Method ids, [] if the type is known but has none, None if the type is not in the dataset."""
    t = types.get(fqn)
    if t is None or t.get("ambiguous"):
        return None
    if fqn in seen:
        return []
    seen.add(fqn)
    if not skip_self:
        hit = [sid for a, sid in t["methods"].get(name, []) if a == arity]
        if hit:
            return hit
    for sup in t["supers"]:
        r = _find(types, sup, name, arity, False, seen)
        if r:
            return r
    return []


def _follow(types: dict, rets: dict[str, str], start: str, chain: tuple) -> tuple[str | None, bool]:
    """The type reached by calling each (name, arity) of the chain in turn, and whether every step was unambiguous."""
    cur, exact = start, True
    for name, arity in chain:
        hit = _find(types, cur, name, arity, False, set())
        if not hit:
            return None, False
        returned = {rets.get(sid) for sid in hit}
        if len(returned) != 1 or None in returned:
            return None, False
        exact = exact and len(hit) == 1
        cur = next(iter(returned))
    return cur, exact


def resolve_call_sites(types: dict, sites: list[CallSite]) -> tuple[list[Relationship], dict]:
    # chain_followed: sites that went through a chain (they are also counted in the outcome that follows);
    # chain_not_followed: chains that left the dataset or hit an unknown or generic return type (counted nowhere else).
    stats = {"resolved": 0, "inferred": 0, "type_in_dataset_method_not_found": 0, "receiver_type_outside_dataset": 0,
             "chain_followed": 0, "chain_not_followed": 0}
    rets = {sid: fqn for t in types.values() for sid, fqn in t.get("rets", {}).items()}
    out: list[Relationship] = []
    seen: set[tuple[str, str]] = set()
    for s in sites:
        chain_exact = True
        if s.chain:
            receiver, chain_exact = _follow(types, rets, s.receiver_fqn, s.chain)
            if receiver is None:
                stats["chain_not_followed"] += 1
                continue
            stats["chain_followed"] += 1
        else:
            receiver = s.receiver_fqn
        hit = _find(types, receiver, s.name, s.arity, s.start_at_supers, set())
        if not hit and s.fallbacks:   # receiver-less call: maybe a statically imported member
            for cls in s.fallbacks:
                alt = _find(types, cls, s.name, s.arity, False, set())
                if alt:
                    hit = alt
                    break
            else:
                if hit is not None and all(_find(types, c, "", 0, False, set()) is None for c in s.fallbacks):
                    hit = None   # every candidate class is outside the dataset
        if hit is None:
            stats["receiver_type_outside_dataset"] += 1
        elif not hit:
            stats["type_in_dataset_method_not_found"] += 1
        else:
            kind = "resolved" if len(hit) == 1 and chain_exact else "inferred"
            stats[kind] += 1
            for sid in hit:
                if (s.caller, sid) not in seen:
                    seen.add((s.caller, sid))
                    out.append(Relationship(source=s.caller, target=sid, type="CALLS", repository=s.repo,
                                            evidence_type=kind, confidence=1 / len(hit),
                                            source_file=s.path, source_line=s.line))
    return out, stats
