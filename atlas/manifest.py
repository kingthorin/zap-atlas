"""Manifest + dataset inventory generation.

Produces the versioned manifest and chunked JSON/JSONL static data.
"""

from __future__ import annotations
import os

import hashlib
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from atlas.config import AtlasConfig
from atlas.ecosystem import discover_ecosystem
from atlas.git_history import extract as extract_history
from atlas.stories import load_stories
from atlas.java_parser import JavaParser
from atlas.schema import (
    SCHEMA_VERSION, GENERATOR_VERSION, Manifest, DatasetInventory,
    Repository, Module, AddOn, Commit, Branch, Tag, Contributor,
    repo_id, module_id, addon_id, commit_id, branch_id, tag_id,
    contributor_id, doc_id, story_id,
)

CHUNK_MANIFEST = "manifest.json"
HISTORY_INDEX = "history_index.json"
CHUNK_REPOS = "repos.jsonl"
CHUNK_COMMITS = "commits.jsonl"
CHUNK_MODULES = "modules.jsonl"
CHUNK_ADDONS = "addons.jsonl"
CHUNK_FILES = "files.jsonl"
CHUNK_SYMBOLS = "symbols.jsonl"
CHUNK_RELS = "relationships.jsonl"
CHUNK_DOCS = "docs.jsonl"
CHUNK_STORIES = "stories.jsonl"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def _write_jsonl(path: Path, rows: list[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(rows)


class AtlasGenerator:
    """Orchestrates analysis + generation for the configured source repos."""

    def __init__(self, config: AtlasConfig) -> None:
        self.config = config
        self.ecosystem_coverage: dict[str, dict] = {}
        self.java_coverage: dict = {}
        self.java_parser = JavaParser()
        self.rows: dict[str, list[dict]] = {
            CHUNK_REPOS: [], CHUNK_COMMITS: [], CHUNK_MODULES: [],
            CHUNK_ADDONS: [], CHUNK_FILES: [], CHUNK_SYMBOLS: [],
            CHUNK_RELS: [], CHUNK_DOCS: [], CHUNK_STORIES: [],
            "branches.jsonl": [], "tags.jsonl": [], "contributors.jsonl": [],
        }

    def run(self, sources_dir: Path, output_dir: Path) -> Manifest:
        output_dir.mkdir(parents=True, exist_ok=True)
        from atlas.sources import checkout_sources
        checkouts = checkout_sources(self.config, sources_dir)
        self.rows[CHUNK_STORIES] = load_stories(self.config.stories_dir)

        names = [s.name for s in self.config.sources]
        for repo_name, repo_path in checkouts.items():
            repo = self.config.sources[names.index(repo_name)]
            self._process_repo(repo, repo_path)

        self._resolve_cross_file()
        chunk_names = self._write_history_shards(output_dir)
        chunk_names += self._write_repo_shards(output_dir, CHUNK_SYMBOLS, "symbols")
        chunk_names += self._write_repo_shards(output_dir, CHUNK_RELS, "relationships")
        for name, rows in self.rows.items():
            if name in (CHUNK_COMMITS, CHUNK_FILES, CHUNK_SYMBOLS, CHUNK_RELS):
                continue
            chunk_path = output_dir / name
            count = _write_jsonl(chunk_path, rows)
            chunk_names.append(name)

        manifest = self._build_manifest(output_dir, chunk_names)
        (output_dir / CHUNK_MANIFEST).write_text(
            json.dumps(asdict(manifest), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"[atlas] wrote {len(chunk_names)} chunks + manifest to {output_dir}")
        return manifest

    def _write_history_shards(self, output_dir: Path) -> list[str]:
        """Write commits and file changes as <kind>/<repo>/<year>.jsonl plus history_index.json."""
        year_of = {c["id"]: c["committer_date"][:4] for c in self.rows[CHUNK_COMMITS]}
        names: list[str] = []
        index: dict[str, dict[str, dict[str, int]]] = {}
        for kind, chunk in (("commits", CHUNK_COMMITS), ("files", CHUNK_FILES)):
            buckets: dict[tuple[str, str], list[dict]] = {}
            for row in self.rows[chunk]:
                commit = row["id"] if kind == "commits" else row["commit"]
                key = (row["repository"], year_of.get(commit) or "unknown")
                buckets.setdefault(key, []).append(row)
            for (repo, year), rows in sorted(buckets.items()):
                name = f"{kind}/{repo}/{year}.jsonl"
                _write_jsonl(output_dir / name, rows)
                names.append(name)
                index.setdefault(repo, {}).setdefault(year, {})[kind] = len(rows)
        (output_dir / HISTORY_INDEX).write_text(json.dumps(index, indent=1), encoding="utf-8")
        names.append(HISTORY_INDEX)
        return names

    def _process_repo(self, repo, repo_path: Path) -> None:
        repo_obj = Repository(id=repo_id(repo.name), name=repo.name, url=repo.url,
                              default_branch=repo.default_branch or "main",
                              sha=repo.sha or "")
        self.rows[CHUNK_REPOS].append(repo_obj.__dict__)

        eco = discover_ecosystem(repo.name, repo_path, repo.sha or None)
        self.rows[CHUNK_MODULES] += eco.modules
        self.rows[CHUNK_ADDONS] += eco.addons
        self.rows[CHUNK_DOCS] += eco.docs
        self.rows[CHUNK_RELS] += eco.relationships
        self.ecosystem_coverage[repo.name] = eco.coverage

        history = extract_history(repo_path, repo.name)
        for c in history.commits.values():
            self.rows[CHUNK_COMMITS].append(Commit(
                id=commit_id(repo.name, c.sha), repository=repo.name, sha=c.sha,
                parents=[commit_id(repo.name, p) for p in c.parents], author_name=c.author_name,
                author_date=c.author_date, committer_date=c.committer_date,
                subject=c.subject, message=c.message,
                branches=c.branches, tags=c.tags,
            ).__dict__)
        for ref in history.refs:
            row = Branch if ref.type == "branch" else Tag
            obj = row(id=(branch_id if ref.type == "branch" else tag_id)(repo.name, ref.name),
                      repository=repo.name, name=ref.name, sha=ref.sha)
            self.rows["branches.jsonl" if ref.type == "branch" else "tags.jsonl"].append(obj.__dict__)
        for fc in history.file_changes:
            self.rows[CHUNK_FILES].append({
                "id": f"file:{repo.name}:{fc.sha}:{fc.path}",
                "commit": commit_id(repo.name, fc.sha), "repository": repo.name,
                "path": fc.path, "change_type": fc.change_type,
                "old_path": fc.old_path, "additions": fc.additions,
                "deletions": fc.deletions,
            })

        seen = set()
        for c in history.commits.values():
            key = c.author_email_norm or c.author_name
            if key in seen:
                continue
            seen.add(key)
            self.rows["contributors.jsonl"].append(Contributor(
                id=contributor_id(repo.name, key), repository=repo.name,
                name=c.author_name, email_norm=c.author_email_norm,
            ).__dict__)

        java_max = int(os.environ["ATLAS_JAVA_MAX"]) if os.environ.get("ATLAS_JAVA_MAX") else None
        java_files = sorted(repo_path.rglob("*.java"))[:java_max]
        stats = {"java_files": 0, "java_parse_errors": 0, "unresolved_calls": 0}
        for jf in java_files:
            rel = jf.relative_to(repo_path).as_posix()
            try:
                result = self.java_parser.parse_file(
                    repo.name, repo.sha or "", rel, jf.read_text(errors="replace"))
            except Exception as e:  # tolerate malformed/unsupported files, but report them
                stats["java_parse_errors"] += 1
                print(f"[atlas] warning: could not parse {repo.name}:{rel}: {e}")
                continue
            stats["java_files"] += 1
            stats["unresolved_calls"] += result.unresolved_calls
            for sym in result.symbols:
                self.rows[CHUNK_SYMBOLS].append(sym.__dict__)
            for rel_ in result.relationships:
                self.rows[CHUNK_RELS].append(asdict(rel_))
        self.java_coverage[repo.name] = stats

    def _resolve_cross_file(self) -> None:
        """Point IMPORTS/EXTENDS/IMPLEMENTS at declared types (any repo) by qualified name."""
        types = {"class", "interface", "enum", "record", "annotation_type"}
        by_qname = {s["qualified_name"]: s["id"] for s in self.rows[CHUNK_SYMBOLS] if s["kind"] in types}
        resolved = 0
        for r in self.rows[CHUNK_RELS]:
            if r["type"] in ("IMPORTS", "EXTENDS", "IMPLEMENTS") and r["evidence_type"] == "syntactic":
                target = by_qname.get(r["target"].split(":", 2)[2])
                if target:
                    r["target"], r["evidence_type"] = target, "resolved"
                    resolved += 1
        self.java_coverage["resolved_type_references"] = resolved

    def _write_repo_shards(self, output_dir: Path, chunk: str, kind: str) -> list[str]:
        # One shard per repo, even when empty (e.g. a docs-only repo), so lookups never 404.
        buckets: dict[str, list[dict]] = {r["name"]: [] for r in self.rows[CHUNK_REPOS]}
        for row in self.rows[chunk]:
            buckets.setdefault(row["repository"], []).append(row)
        names = []
        for repo, rows in sorted(buckets.items()):
            name = f"{kind}/{repo}.jsonl"
            _write_jsonl(output_dir / name, rows)
            names.append(name)
        return names

    def _build_manifest(self, output_dir: Path, chunk_names: list[str]) -> Manifest:
        inventory = []
        for name in chunk_names:
            p = output_dir / name
            inventory.append(DatasetInventory(name=name, items=0,
                                              size_bytes=p.stat().st_size,
                                              sha256=_sha256_file(p)))
        return Manifest(
            schema_version=SCHEMA_VERSION,
            generator_version=GENERATOR_VERSION,
            generated_at=datetime.now(timezone.utc).isoformat(),
            sources=[{"name": s.name, "url": s.url, "sha": s.sha,
                      "ref": s.branch or s.default_branch} for s in self.config.sources],
            inventory=inventory,
            coverage={"note": "Modules, add-ons and help reflect current structure at the checked-out HEAD only; "
                      "help is English only; older (Ant-era) layouts are not parsed.",
                      "ecosystem": self.ecosystem_coverage,
                      "java": self.java_coverage},
            chunks=chunk_names,
        )

