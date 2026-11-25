"""Manifest + dataset inventory generation.

Produces the versioned manifest and chunked JSON/JSONL static data.
"""

from __future__ import annotations

from atlas import jsonfmt
import os

import copy
import hashlib
import json
import pickle
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from atlas.config import AtlasConfig
from atlas.call_resolution import resolve_call_sites
from atlas.ecosystem import discover_ecosystem
from atlas.git_history import extract as extract_history
from atlas.languages import count_languages
from atlas.milestones import build_milestones
from atlas.stories import load_stories
from atlas.sharding import write_module_shards
from atlas import fingerprint
from atlas.activity import write_activity
from atlas.credits import CORE_TEAM, core_team
from atlas.release_windows import write_core_windows
from atlas.timeline import write_timeline
from atlas.java_parser import JavaParser
from atlas.schema import (
    SCHEMA_VERSION, GENERATOR_VERSION, Manifest, DatasetInventory,
    Repository, Module, AddOn, Commit, Branch, Tag, Contributor, Relationship,
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
CHUNK_LANGS = "languages.jsonl"
CHUNK_MILESTONES = "milestones.jsonl"


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


CACHE_DIR = ".atlas-cache"


@dataclass
class RepoDelta:
    """What processing one repository added to the generator's state, for replaying it without the repository."""
    sha: str
    default_branch: str
    rows: dict
    call_sites: list
    types: dict
    ecosystem: dict | None
    milestones: dict | None
    java: dict | None
    core_team: dict | None


GENERATED_DIRS = ("commits", "files", "symbols", "relationships", "incoming", "shards", "author_modules")


def _previous_chunks(output_dir: Path) -> set[str]:
    """The files the previous run listed in its manifest (empty if there was none)."""
    try:
        return set(json.loads((output_dir / CHUNK_MANIFEST).read_text(encoding="utf-8")).get("chunks", []))
    except (OSError, ValueError):
        return set()


def _remove_stale(output_dir: Path, current: set[str], previous: set[str]) -> int:
    """Delete files an earlier run wrote that this run did not, so a rebuilt dataset has no leftovers.

    Only generator-owned files go: those the previous manifest listed, and anything under the generated data
    directories. Hidden files and anything else in the output directory are left alone. (search/ is written after
    this step and is rebuilt by ``atlas analyze``.)
    """
    gone = {n for n in previous if n not in current}
    for d in GENERATED_DIRS:
        base = output_dir / d
        if base.is_dir():
            gone |= {p.relative_to(output_dir).as_posix() for p in base.rglob("*")
                     if p.is_file() and not p.name.startswith(".") and p.relative_to(output_dir).as_posix() not in current}
    for n in gone:
        (output_dir / n).unlink(missing_ok=True)
    for d in GENERATED_DIRS:                                  # empty directories left behind
        base = output_dir / d
        for p in sorted((q for q in base.rglob("*") if q.is_dir()), reverse=True) if base.is_dir() else []:
            if not any(p.iterdir()):
                p.rmdir()
    return len(gone)


class AtlasGenerator:
    """Orchestrates analysis + generation for the configured source repos."""

    def __init__(self, config: AtlasConfig) -> None:
        self.config = config
        self.ecosystem_coverage: dict[str, dict] = {}
        self.java_coverage: dict = {}
        self.milestone_coverage: dict[str, dict] = {}
        self.java_types: dict = {}       # qualified type name -> info, across all repos
        self.call_sites: list = []
        self.core_team: dict | None = None   # from the help credits page history
        self.fingerprint = ""
        self._repo_types: dict = {}
        self.java_parser = JavaParser()
        self.rows: dict[str, list[dict]] = {
            CHUNK_REPOS: [], CHUNK_COMMITS: [], CHUNK_MODULES: [],
            CHUNK_ADDONS: [], CHUNK_FILES: [], CHUNK_SYMBOLS: [],
            CHUNK_RELS: [], CHUNK_DOCS: [], CHUNK_STORIES: [], CHUNK_LANGS: [], CHUNK_MILESTONES: [],
            "branches.jsonl": [], "tags.jsonl": [], "contributors.jsonl": [],
        }

    def run(self, sources_dir: Path, output_dir: Path, force: bool = False) -> Manifest | None:
        """Build the dataset. Returns None when ``output_dir`` already holds one built from the same inputs.

        A repository at a commit that was parsed before (same generator code) is replayed from the cache in
        ``<sources>/.atlas-cache`` without being cloned or parsed; only repositories that moved are processed.
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        from atlas.sources import checkout_sources
        remote: dict[str, str] = {}
        if not force:
            try:
                remote = {s.name: fingerprint.remote_sha(s) for s in self.config.sources}
            except Exception as e:               # offline or unknown ref: do the full work
                print(f"[atlas] could not read the upstream commits ({e}); analysing everything")
        if remote:
            expected = fingerprint.key(self.config, remote)
            if fingerprint.is_current(output_dir, expected):
                print(f"[atlas] {output_dir} is up to date: same upstream commits, generator and stories "
                      f"(fingerprint {expected[:12]}). Use --force to rebuild.")
                return None
        cache_dir = sources_dir / CACHE_DIR
        deltas = {s.name: self._load_delta(cache_dir, s, remote.get(s.name)) for s in self.config.sources}
        misses = [s for s in self.config.sources if deltas[s.name] is None]
        checkouts = checkout_sources(AtlasConfig(sources=misses, sources_dir=self.config.sources_dir), sources_dir) if misses else {}
        for s in self.config.sources:
            if deltas[s.name] is not None:
                s.sha, s.default_branch = deltas[s.name].sha, deltas[s.name].default_branch
                print(f"[atlas] {s.name} @ {s.sha} reused from the cache (not cloned or parsed)")
        self.fingerprint = fingerprint.key(self.config, {s.name: s.sha or "" for s in self.config.sources})
        self.rows[CHUNK_STORIES] = load_stories(self.config.stories_dir)

        for repo in self.config.sources:
            if deltas[repo.name] is not None:
                self._apply_delta(deltas[repo.name])
            else:
                before = self._snapshot()
                self._process_repo(repo, checkouts[repo.name])
                self._save_delta(cache_dir, repo, self._capture(repo, before))

        self._resolve_cross_file()
        self._resolve_calls_and_api()
        self._link_milestones()
        previous = _previous_chunks(output_dir)
        chunk_names = self._write_history_shards(output_dir)
        chunk_names += write_module_shards(
            output_dir, [r["name"] for r in self.rows[CHUNK_REPOS]], self.rows[CHUNK_MODULES], self.rows[CHUNK_ADDONS],
            self.rows[CHUNK_SYMBOLS], self.rows[CHUNK_RELS])
        for name, rows in self.rows.items():
            if name in (CHUNK_COMMITS, CHUNK_FILES, CHUNK_SYMBOLS, CHUNK_RELS):
                continue
            chunk_path = output_dir / name
            count = _write_jsonl(chunk_path, rows)
            chunk_names.append(name)

        manifest = self._build_manifest(output_dir, chunk_names)
        (output_dir / CHUNK_MANIFEST).write_text(
            jsonfmt.dumps(asdict(manifest), ensure_ascii=False),
            encoding="utf-8",
        )
        removed = _remove_stale(output_dir, set(chunk_names), previous)
        print(f"[atlas] wrote {len(chunk_names)} chunks + manifest to {output_dir}" + (f"; removed {removed} stale files" if removed else ""))
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
        (output_dir / HISTORY_INDEX).write_text(jsonfmt.dumps(index), encoding="utf-8")
        names.append(HISTORY_INDEX)
        names.append(write_timeline(output_dir, self.rows[CHUNK_COMMITS]))
        names.append(write_core_windows(output_dir, self.rows[CHUNK_MILESTONES], self.rows[CHUNK_COMMITS]))
        if self.core_team:
            (output_dir / CORE_TEAM).write_text(jsonfmt.dumps(self.core_team, ensure_ascii=False), encoding="utf-8")
            names.append(CORE_TEAM)
        names += write_activity(output_dir, self.rows[CHUNK_MODULES], self.rows[CHUNK_COMMITS], self.rows[CHUNK_FILES], self.rows[CHUNK_SYMBOLS], self.rows[CHUNK_DOCS])
        return names

    # -- per-repository cache ----------------------------------------------------------------------

    def _delta_path(self, cache_dir: Path, repo, sha: str) -> Path:
        key = hashlib.sha256(json.dumps([repo.name, sha, fingerprint.code_hash(), os.environ.get("ATLAS_JAVA_MAX", "")]).encode()).hexdigest()[:16]
        return cache_dir / f"{repo.name}-{key}.pkl"

    def _load_delta(self, cache_dir: Path, repo, sha: str | None) -> "RepoDelta | None":
        if not sha:
            return None
        path = self._delta_path(cache_dir, repo, sha)
        if not path.is_file():
            return None
        try:
            with path.open("rb") as f:
                delta = pickle.load(f)
            return delta if isinstance(delta, RepoDelta) and delta.sha == sha else None
        except Exception:                      # an unreadable entry is just a miss
            return None

    def _save_delta(self, cache_dir: Path, repo, delta: "RepoDelta") -> None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        for old in cache_dir.glob(f"{repo.name}-*.pkl"):      # only the latest commit of a repository is worth keeping
            old.unlink()
        with self._delta_path(cache_dir, repo, delta.sha).open("wb") as f:
            pickle.dump(delta, f, protocol=pickle.HIGHEST_PROTOCOL)

    def _snapshot(self) -> dict:
        return {"rows": {k: len(v) for k, v in self.rows.items()}, "calls": len(self.call_sites), "team": self.core_team}

    def _capture(self, repo, before: dict) -> "RepoDelta":
        name = repo.name
        return RepoDelta(
            sha=repo.sha or "", default_branch=repo.default_branch or "main",
            rows={k: self.rows[k][before["rows"].get(k, 0):] for k in self.rows if len(self.rows[k]) > before["rows"].get(k, 0)},
            call_sites=self.call_sites[before["calls"]:], types=self._repo_types,
            ecosystem=self.ecosystem_coverage.get(name), milestones=self.milestone_coverage.get(name), java=self.java_coverage.get(name),
            core_team=self.core_team if self.core_team is not before["team"] else None)

    def _apply_delta(self, d: "RepoDelta") -> None:
        for k, rows in d.rows.items():
            self.rows[k] += rows
        self.call_sites += d.call_sites
        self._merge_types(copy.deepcopy(d.types))
        repo = d.rows[CHUNK_REPOS][0]["name"]
        self.ecosystem_coverage[repo], self.milestone_coverage[repo], self.java_coverage[repo] = d.ecosystem, d.milestones, d.java
        if d.core_team:
            self.core_team = d.core_team

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
        self.rows[CHUNK_LANGS] += count_languages(repo.name, repo_path, [m["path"] for m in eco.modules])

        history = extract_history(repo_path, repo.name)
        team = core_team(repo_path)
        if team:
            self.core_team = team
        self._attach_doc_history(repo.name, history)
        names = {a["id"].removeprefix("addon:"): a["name"] for a in eco.addons}
        ms, ms_cov = build_milestones(repo.name, repo_path, set(history.commits), names)
        self.rows[CHUNK_MILESTONES] += ms
        self.milestone_coverage[repo.name] = ms_cov
        lines: dict[str, list[int]] = {}
        for fc in history.file_changes:
            tot = lines.setdefault(fc.sha, [0, 0])
            tot[0] += fc.additions
            tot[1] += fc.deletions
        for c in history.commits.values():
            self.rows[CHUNK_COMMITS].append(Commit(
                id=commit_id(repo.name, c.sha), repository=repo.name, sha=c.sha,
                parents=[commit_id(repo.name, p) for p in c.parents], author_name=c.author_name,
                author_date=c.author_date, committer_date=c.committer_date,
                subject=c.subject, message=c.message,
                branches=c.branches, tags=c.tags,
                additions=lines.get(c.sha, [0, 0])[0], deletions=lines.get(c.sha, [0, 0])[1],
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
        repo_types: dict = {}            # this repository's own types, before the cross-repository merge
        stats = {"java_files": 0, "java_parse_errors": 0, "unresolved_calls": 0, "calls_total": 0,
                 "calls_resolved_same_type": 0, "calls_inferred_same_type": 0}
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
            stats["calls_total"] += result.calls_total
            stats["calls_resolved_same_type"] += result.calls_resolved_same_type
            stats["calls_inferred_same_type"] += result.calls_inferred_same_type
            self.call_sites += result.call_sites
            for fqn, info in result.types.items():
                if fqn in repo_types:
                    repo_types[fqn]["ambiguous"] = True        # same name declared twice: never guess
                else:
                    repo_types[fqn] = info
            for sym in result.symbols:
                self.rows[CHUNK_SYMBOLS].append(sym.__dict__)
            for rel_ in result.relationships:
                self.rows[CHUNK_RELS].append(asdict(rel_))
        self.java_coverage[repo.name] = stats
        self._repo_types = copy.deepcopy(repo_types)             # what a cache entry stores
        self._merge_types(repo_types)

    def _merge_types(self, repo_types: dict) -> None:
        for fqn, info in repo_types.items():
            if fqn in self.java_types:
                self.java_types[fqn]["ambiguous"] = True       # same name declared in two places: never guess
            else:
                self.java_types[fqn] = info

    def _attach_doc_history(self, repo_name: str, history) -> None:
        """Commit count, last change and recent commits per help page, following renames."""
        docs = [d for d in self.rows[CHUNK_DOCS] if d["repository"] == repo_name]
        if not docs:
            return
        order = {sha: i for i, sha in enumerate(history.commits)}
        changes = sorted(history.file_changes, key=lambda fc: order.get(fc.sha, 0), reverse=True)  # newest first
        tracked = {d["path"]: d["path"] for d in docs}  # name at that point in time -> current path
        found: dict[str, list[str]] = {}
        for fc in changes:
            cur = tracked.get(fc.path)
            if cur is None:
                continue
            shas = found.setdefault(cur, [])
            if not shas or shas[-1] != fc.sha:
                shas.append(fc.sha)
            if fc.change_type.startswith("R") and fc.old_path:
                tracked[fc.old_path] = cur
        for d in docs:
            shas = found.get(d["path"], [])
            d["commit_count"] = len(shas)
            d["last_changed"] = history.commits[shas[0]].committer_date if shas else None
            d["commits"] = [commit_id(repo_name, s) for s in shas[:50]]

    def _resolve_calls_and_api(self) -> None:
        """Calls on typed receivers, then module-level USES_API edges from resolved cross-repo imports."""
        edges, call_stats = resolve_call_sites(self.java_types, self.call_sites)
        self.rows[CHUNK_RELS] += [asdict(e) for e in edges]
        self.java_coverage["calls"] = call_stats
        mods: dict[str, list[tuple[str, str]]] = {}
        for m in self.rows[CHUNK_MODULES]:
            mods.setdefault(m["repository"], []).append((m["path"], m["id"]))
        for v in mods.values():
            v.sort(key=lambda x: len(x[0]), reverse=True)
        sym = {x["id"]: x for x in self.rows[CHUNK_SYMBOLS]}
        seen, api = set(), []
        for r in self.rows[CHUNK_RELS]:
            if r["type"] != "IMPORTS" or r["evidence_type"] != "resolved":
                continue
            src, dst = sym.get(r["source"]), sym.get(r["target"])
            if not src or not dst or src["repository"] == dst["repository"]:
                continue
            path = src["file"].split(":", 3)[3]
            module = next((mid for mp, mid in mods.get(src["repository"], []) if path.startswith(mp + "/")), None)
            if module and (module, dst["id"]) not in seen:
                seen.add((module, dst["id"]))
                api.append({"source": module, "target": dst["id"], "type": "USES_API",
                            "repository": src["repository"], "source_revision": None,
                            "evidence_type": "resolved", "confidence": 1.0, "source_file": path,
                            "source_line": None, "valid_from": None, "valid_to": None})
        self.rows[CHUNK_RELS] += api
        self.java_coverage["uses_api_edges"] = len(api)

    def _link_milestones(self) -> None:
        """Release-notes pages for core releases, and PART_OF edges from add-on releases to their add-on."""
        docs = {d["id"] for d in self.rows[CHUNK_DOCS]}
        for m in self.rows[CHUNK_MILESTONES]:
            if m["kind"] == "core-release":
                path = f"addOns/help/src/main/javahelp/contents/releases/{m['version']}.html"
                did = f"doc:zap-core-help:{path}"
                if did in docs:
                    m["release_notes"] = did
                    self.rows[CHUNK_RELS].append(asdict(Relationship(
                        source=did, target=m["id"], type="DOCUMENTS", repository="zap-core-help",
                        evidence_type="resolved", source_file=path)))
            elif m["kind"] == "addon-release" and m["addon"]:
                self.rows[CHUNK_RELS].append(asdict(Relationship(
                    source=m["id"], target=m["addon"], type="PART_OF", repository=m["repository"],
                    evidence_type="resolved")))

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
                      "java": self.java_coverage,
                      "milestones": self.milestone_coverage},
            chunks=chunk_names,
            fingerprint=self.fingerprint,
        )

