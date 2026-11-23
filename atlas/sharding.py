"""Per-module shards for symbols and relationships.

Layout, for each repository ``<repo>``::

    symbols/<repo>/<shard>.jsonl         symbols declared in that shard's files
    relationships/<repo>/<shard>.jsonl   edges whose source lives in that shard
    incoming/<repo>/<shard>.jsonl        edges from another shard whose target symbol is in this one
    shards/<repo>.json                   shard list, row counts, and symbol id -> shard

A shard is a module path. A module whose rows exceed LIMIT bytes is split by directory, and a
directory below MIN bytes stays in its parent's shard. Shard names replace "/" with "__".
Files that belong to no module go to ``_root``, and edges with no file or symbol source (release
links) go to ``_meta``. ``module_graph.json`` aggregates edges between modules for the graph view.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

LIMIT = 3_000_000
MIN = 256_000
ROOT, META = "_root", "_meta"
KINDS = ("symbols", "relationships", "incoming")
MODULE_GRAPH = "module_graph.json"
SKIP_EDGE_TYPES = {"CONTAINS", "PART_OF"}


def shard_name(key: str) -> str:
    return key.replace("/", "__")


def _prefixes(path: str):
    segs = path.split("/")
    for i in range(len(segs), 0, -1):
        yield "/".join(segs[:i])


def file_path(file_id: str) -> str:
    """Path from a file id ``file:<repo>:<sha>:<path>``."""
    return file_id.split(":", 3)[3]


class RepoShards:
    def __init__(self, module_paths: list[str], weights: dict[str, int]) -> None:
        self.modules = set(module_paths)
        self.keys = set(self.modules)
        by_module: dict[str, dict[str, int]] = {}
        for path, w in weights.items():
            m = self.module_of(path)
            if m != ROOT:
                by_module.setdefault(m, {})[path] = w
        for m, items in by_module.items():
            if sum(items.values()) > LIMIT:
                self._split(m, items)

    def _split(self, prefix: str, items: dict[str, int]) -> None:
        children: dict[str, dict[str, int]] = {}
        for path, w in items.items():
            rel = path[len(prefix) + 1:]
            if "/" in rel:
                children.setdefault(f"{prefix}/{rel.split('/')[0]}", {})[path] = w
        for child, sub in children.items():
            total = sum(sub.values())
            if total >= MIN:
                self.keys.add(child)
                if total > LIMIT:
                    self._split(child, sub)

    def module_of(self, path: str) -> str:
        for p in _prefixes(path):
            if p in self.modules:
                return p
        return ROOT

    def key_of(self, path: str) -> str:
        for p in _prefixes(path):
            if p in self.keys:
                return p
        return ROOT


def _rows_bytes(row: dict) -> int:
    return len(json.dumps(row, ensure_ascii=False))


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_module_shards(output_dir: Path, repos: list[str], modules: list[dict], addons: list[dict],
                        symbols: list[dict], rels: list[dict]) -> list[str]:
    """Write the shard files, their indexes and module_graph.json; return the chunk names written."""
    names: list[str] = []
    sym_module: dict[str, str] = {}     # symbol id -> module id, across repositories
    for repo in repos:
        mods = [m["path"] for m in modules if m["repository"] == repo]
        repo_syms = [s for s in symbols if s["repository"] == repo]
        repo_rels = [r for r in rels if r["repository"] == repo]
        weights: dict[str, int] = {}
        for s in repo_syms:
            p = file_path(s["file"])
            weights[p] = weights.get(p, 0) + _rows_bytes(s)
        for r in repo_rels:
            if r.get("source_file"):
                weights[r["source_file"]] = weights.get(r["source_file"], 0) + _rows_bytes(r)
        plan = RepoShards(mods, weights)
        sym_key = {s["id"]: plan.key_of(file_path(s["file"])) for s in repo_syms}
        for s in repo_syms:
            m = plan.module_of(file_path(s["file"]))
            if m != ROOT:
                sym_module[s["id"]] = f"module:{repo}:{m}"
        buckets: dict[str, dict[str, list[dict]]] = {k: {} for k in KINDS}
        for s in repo_syms:
            buckets["symbols"].setdefault(sym_key[s["id"]], []).append(s)
        for r in repo_rels:
            if r["source"] in sym_key:
                owner = sym_key[r["source"]]
            elif r.get("source_file"):
                owner = plan.key_of(r["source_file"])
            else:
                owner = META
            buckets["relationships"].setdefault(owner, []).append(r)
            target = sym_key.get(r["target"])
            if target is not None and target != owner:
                buckets["incoming"].setdefault(target, []).append(r)
        keys = sorted(set().union(*[set(b) for b in buckets.values()]))
        for kind in KINDS:
            for key, rows in buckets[kind].items():
                name = f"{kind}/{repo}/{shard_name(key)}.jsonl"
                _write(output_dir / name, rows)
                names.append(name)
        index = {"keys": keys, "n": [[len(buckets[k].get(key, [])) for k in KINDS] for key in keys],
                 "s": {sid.split(":", 2)[2]: keys.index(k) for sid, k in sym_key.items()}}
        name = f"shards/{repo}.json"
        (output_dir / name).parent.mkdir(parents=True, exist_ok=True)
        (output_dir / name).write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        names.append(name)
    names.append(_write_module_graph(output_dir, modules, addons, sym_module, rels))
    return names


def _write_module_graph(output_dir: Path, modules: list[dict], addons: list[dict],
                        sym_module: dict[str, str], rels: list[dict]) -> str:
    addon_module = {a["id"]: a["module"] for a in addons if a.get("module")}
    known = {m["id"] for m in modules}

    def module_of(entity: str) -> str | None:
        if entity in sym_module:
            return sym_module[entity]
        if entity in known:
            return entity
        return addon_module.get(entity)

    counts: Counter = Counter()
    for r in rels:
        if r["type"] in SKIP_EDGE_TYPES:
            continue
        s, t = module_of(r["source"]), module_of(r["target"])
        if s and t and s != t:
            counts[(s, t, r["type"])] += 1
    nodes = sorted({n for s, t, _ in counts for n in (s, t)})
    at = {n: i for i, n in enumerate(nodes)}
    edges = [[at[s], at[t], ty, n] for (s, t, ty), n in sorted(counts.items())]
    (output_dir / MODULE_GRAPH).write_text(
        json.dumps({"nodes": nodes, "edges": edges}, separators=(",", ":")), encoding="utf-8")
    return MODULE_GRAPH


def _read(dataset: Path, kind: str, repo: str) -> list[dict]:
    """Rows of one kind and repository, from either the old single file or the shard directory."""
    paths = [dataset / kind / f"{repo}.jsonl"] if (dataset / kind / f"{repo}.jsonl").is_file() \
        else sorted((dataset / kind / repo).glob("*.jsonl"))
    return [json.loads(l) for p in paths for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def _jsonl(dataset: Path, name: str) -> list[dict]:
    p = dataset / name
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.is_file() else []


def reshard(dataset: Path) -> list[str]:
    """Rewrite symbols and relationships of an existing dataset into module shards."""
    import hashlib
    import shutil
    repos = [r["name"] for r in _jsonl(dataset, "repos.jsonl")]
    symbols = [s for r in repos for s in _read(dataset, "symbols", r)]
    rels = [x for r in repos for x in _read(dataset, "relationships", r)]
    for kind in KINDS + ("shards",):
        shutil.rmtree(dataset / kind, ignore_errors=True)
    for kind in ("symbols", "relationships"):
        for r in repos:
            (dataset / kind / f"{r}.jsonl").unlink(missing_ok=True)
    names = write_module_shards(dataset, repos, _jsonl(dataset, "modules.jsonl"), _jsonl(dataset, "addons.jsonl"), symbols, rels)
    mpath = dataset / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    stale = lambda n: n.split("/")[0] in KINDS + ("shards",) or n == MODULE_GRAPH
    manifest["chunks"] = [c for c in manifest["chunks"] if not stale(c)] + names
    manifest["inventory"] = [i for i in manifest["inventory"] if not stale(i["name"])] + [
        {"name": n, "items": 0, "size_bytes": (dataset / n).stat().st_size,
         "sha256": hashlib.sha256((dataset / n).read_bytes()).hexdigest()} for n in names]
    mpath.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return names
