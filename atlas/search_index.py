"""Static search index: compact per-group JSON files under search/.

Groups load independently in the browser: ``ecosystem`` (repos, modules, add-ons,
docs, stories), ``symbols`` (declared types only; members stay reachable from
their type/module pages) and ``commits`` (subject, short SHA, repo).

Record: ``k`` kind, ``i`` entity id, ``t`` title, ``x`` extra searchable text,
``u`` external URL (docs only), ``y`` year (commits only, used for the commit shard hint).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

_TYPE_KINDS = {"class", "interface", "enum", "record", "annotation_type"}


def _rows(dataset: Path, pattern: str):
    for p in sorted(dataset.glob(pattern)):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)


def build_search_index(dataset: Path) -> list[str]:
    """Write search/*.json, register them in manifest.json, return the new chunk names."""
    repos = {r["name"]: r for r in _rows(dataset, "repos.jsonl")}
    eco: list[dict] = []
    for r in repos.values():
        eco.append({"k": "repository", "i": r["id"], "t": r["name"], "x": r.get("url", "")})
    for m in _rows(dataset, "modules.jsonl"):
        eco.append({"k": "module", "i": m["id"], "t": m["path"], "x": m["repository"]})
    for a in _rows(dataset, "addons.jsonl"):
        eco.append({"k": "addon", "i": a["id"], "t": a["name"],
                    "x": " ".join([a["id"].removeprefix("addon:"), a.get("status") or "", a.get("author") or ""])})
    for d in _rows(dataset, "docs.jsonl"):
        repo = repos.get(d["repository"])
        url = f'{repo["url"].removesuffix(".git")}/blob/{repo["sha"]}/{d["path"]}' if repo else None
        eco.append({"k": "doc", "i": d["id"], "t": d["title"], "x": " ".join(d.get("headings", [])[1:]), "u": url})
    for s in _rows(dataset, "stories.jsonl"):
        eco.append({"k": "story", "i": s["id"], "t": s["title"], "x": s.get("description", "")})

    symbols = [{"k": s["kind"], "i": s["id"], "t": s["qualified_name"]}
               for s in _rows(dataset, "symbols/*.jsonl") if s["kind"] in _TYPE_KINDS]

    commits = []
    for p in sorted(dataset.glob("commits/*/*.jsonl")):
        year = p.stem
        for line in p.open(encoding="utf-8"):
            if line.strip():
                c = json.loads(line)
                commits.append({"k": "commit", "i": c["id"], "t": c["subject"],
                                "x": f'{c["sha"][:10]} {c["repository"]}', "y": year})

    names = []
    out = dataset / "search"
    out.mkdir(exist_ok=True)
    for group, rows in (("ecosystem", eco), ("symbols", symbols), ("commits", commits)):
        name = f"search/{group}.json"
        (dataset / name).write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        names.append(name)
    _register(dataset, names)
    return names


def _register(dataset: Path, names: list[str]) -> None:
    mpath = dataset / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    known = {i["name"] for i in manifest["inventory"]}
    for name in names:
        data = (dataset / name).read_bytes()
        entry = {"name": name, "items": 0, "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        manifest["inventory"] = [i for i in manifest["inventory"] if i["name"] != name] + [entry]
        if name not in manifest["chunks"]:
            manifest["chunks"].append(name)
    mpath.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
