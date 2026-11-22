"""Human-readable dataset report (sources, coverage, sizes) as Markdown."""

from __future__ import annotations

import json
import zlib
from pathlib import Path


def _gz(path: Path) -> int:
    c, n = zlib.compressobj(6), 0
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            n += len(c.compress(block))
    return n + len(c.flush())


def _mb(n: int) -> str:
    return f"{n / 1048576:.1f} MB"


def build_report(dataset: Path) -> str:
    m = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    files = sorted(p for p in dataset.rglob("*") if p.is_file() and not p.name.startswith("."))
    by_group: dict[str, list[int]] = {}
    for p in files:
        g = p.relative_to(dataset).parts[0].removesuffix(".jsonl").removesuffix(".json")
        t = by_group.setdefault(g, [0, 0, 0])
        t[0] += 1
        t[1] += p.stat().st_size
        t[2] += _gz(p)
    biggest = sorted(files, key=lambda p: p.stat().st_size, reverse=True)[:5]
    cov = m.get("coverage", {})
    out = ["# ZAP Atlas dataset report", "",
           f"Generated {m['generated_at']} · schema {m['schema_version']} · generator {m['generator_version']}", "",
           "## Sources", "", "| Repository | Ref | SHA |", "|---|---|---|"]
    out += [f"| [{s['name']}]({s['url'].removesuffix('.git')}) | {s.get('ref') or ''} | `{s['sha']}` |" for s in m["sources"]]
    out += ["", "## Size", "", f"{len(files)} files, {_mb(sum(t[1] for t in by_group.values()))} raw, "
            f"{_mb(sum(t[2] for t in by_group.values()))} gzipped (static hosts serve gzip).", "",
            "| Group | Files | Raw | Gzipped |", "|---|---|---|---|"]
    out += [f"| {g} | {t[0]} | {_mb(t[1])} | {_mb(t[2])} |" for g, t in sorted(by_group.items(), key=lambda x: -x[1][1])]
    out += ["", "Largest single files: " + ", ".join(f"`{p.relative_to(dataset)}` ({_mb(p.stat().st_size)})" for p in biggest), ""]
    out += ["## Coverage and limitations", "", cov.get("note", ""), ""]
    for repo, c in cov.get("ecosystem", {}).items():
        out.append(f"- **{repo}**: " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in c.items()))
    for key, c in cov.get("java", {}).items():
        out.append(f"- **java {key}**: " + (", ".join(f"{k.replace('_', ' ')} {v:,}" for k, v in c.items()) if isinstance(c, dict) else f"{c:,}"))
    return "\n".join(out) + "\n"
