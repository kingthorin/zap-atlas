"""Manifest + dataset inventory generation.

Produces the versioned manifest and chunked JSON/JSONL static data.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from atlas.config import AtlasConfig
from atlas.git_history import extract as extract_history
from atlas.java_parser import JavaParser
from atlas.schema import (
    SCHEMA_VERSION, GENERATOR_VERSION, Manifest, DatasetInventory,
    Repository, Module, AddOn, Commit, Branch, Tag, Contributor,
    repo_id, module_id, addon_id, commit_id, branch_id, tag_id,
    contributor_id, doc_id, story_id,
)

CHUNK_MANIFEST = "manifest.json"
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
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(rows)


class AtlasGenerator:
    """Orchestrates analysis + generation for the configured source repos."""

    def __init__(self, config: AtlasConfig) -> None:
        self.config = config
        self.java_parser = JavaParser()
        self.rows: dict[str, list[dict]] = {
            CHUNK_REPOS: [], CHUNK_COMMITS: [], CHUNK_MODULES: [],
            CHUNK_ADDONS: [], CHUNK_FILES: [], CHUNK_SYMBOLS: [],
            CHUNK_RELS: [], CHUNK_DOCS: [], CHUNK_STORIES: [],
            "branches": [], "tags": [], "contributors": [],
        }

    def run(self, sources_dir: Path, output_dir: Path) -> Manifest:
        output_dir.mkdir(parents=True, exist_ok=True)
        from atlas.sources import checkout_sources
        checkouts = checkout_sources(self.config, sources_dir)

        names = [s.name for s in self.config.sources]
        for repo_name, repo_path in checkouts.items():
            repo = self.config.sources[names.index(repo_name)]
            self._process_repo(repo, repo_path)

        chunk_names = []
        for name, rows in self.rows.items():
            if not rows:
                continue
            chunk_path = output_dir / name
            count = _write_jsonl(chunk_path, rows)
            chunk_names.append(name)

        manifest = self._build_manifest(output_dir, chunk_names)
        (output_dir / CHUNK_MANIFEST).write_text(
            json.dumps(manifest.__dict__, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"[atlas] wrote {len(chunk_names)} chunks + manifest to {output_dir}")
        return manifest

    def _process_repo(self, repo, repo_path: Path) -> None:
        repo_obj = Repository(id=repo_id(repo.name), name=repo.name, url=repo.url,
                              default_branch=repo.default_branch or "main",
                              sha=repo.sha or "")
        self.rows[CHUNK_REPOS].append(repo_obj.__dict__)

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
            self.rows["branches" if ref.type == "branch" else "tags"].append(obj.__dict__)
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
            self.rows["contributors"].append(Contributor(
                id=contributor_id(repo.name, key), repository=repo.name,
                name=c.author_name, email_norm=c.author_email_norm,
            ).__dict__)

        # MVP: limit Java files per repo for fast iteration
        java_max = config.focus_modules[0] if config.focus_modules else 50
        java_files = sorted(repo_path.rglob("*.java"))[:java_max]
        for jf in java_files:
            result = self.java_parser.parse_file(
                repo.name, repo.sha or "", rel, jf.read_text(errors="replace"))
            for s in result.symbols:
                self.rows[CHUNK_SYMBOLS].append(s.__dict__)
            for rel_ in result.relationships:
                self.rows[CHUNK_RELS].append({
                    "source": rel_.source, "target": rel_.target, "type": rel_.type,
                    "repository": rel_.repository, "source_revision": rel_.source_revision,
                    "evidence_type": rel_.evidence_type, "confidence": rel_.confidence,
                    "source_file": rel_.source_file, "source_line": rel_.source_line,
                    "valid_from": rel_.valid_from, "valid_to": rel_.valid_to,
                })

    def _build_manifest(self, output_dir: Path, chunk_names: list[str]) -> Manifest:
        inventory = []
        for name in chunk_names + [CHUNK_MANIFEST]:
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
            coverage={"note": "MVP vertical slice; coverage reported per-module"},
            chunks=chunk_names,
        )

