"""Resolve call sites against the declared types of every parsed file.

A call is ``resolved`` when its receiver's declared type is in the dataset and has
exactly one method of that name and arity (searching supertypes that are also in
the dataset); ``inferred`` when several match. No overload resolution beyond arity,
no generics, no ``var``, no chained calls: those stay out of the graph and are counted.
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


def resolve_call_sites(types: dict, sites: list[CallSite]) -> tuple[list[Relationship], dict]:
    stats = {"resolved": 0, "inferred": 0, "type_in_dataset_method_not_found": 0, "receiver_type_outside_dataset": 0}
    out: list[Relationship] = []
    seen: set[tuple[str, str]] = set()
    for s in sites:
        hit = _find(types, s.receiver_fqn, s.name, s.arity, s.start_at_supers, set())
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
            kind = "resolved" if len(hit) == 1 else "inferred"
            stats[kind] += 1
            for sid in hit:
                if (s.caller, sid) not in seen:
                    seen.add((s.caller, sid))
                    out.append(Relationship(source=s.caller, target=sid, type="CALLS", repository=s.repo,
                                            evidence_type=kind, confidence=1 / len(hit),
                                            source_file=s.path, source_line=s.line))
    return out, stats
