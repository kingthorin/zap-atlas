"""Versioned ZAP Atlas data model.

Defines entity types, deterministic IDs, relationship shapes, and the manifest
structure. All IDs are globally unique and repository-qualified to avoid
collisions across repositories, packages, same-named types, and overloads.

ID schemes:
    repo:zaproxy
    repo:zap-extensions
    repo:zap-core-help
    module:zap-extensions:addOns/ascanrules
    module:zaproxy:zap
    addon:ascanrules
    addon:automation
    file:zaproxy:<sha>:org/zaproxy/zap/Extension.java
    symbol:zaproxy:org.zaproxy.zap.Extension#getMainUI()
    commit:zaproxy:<full-sha>
    branch:zaproxy:main
    tag:zaproxy:v2.14.0
    contributor:zaproxy:user
    doc:zap-core-help:help:contents/ui/overview.html
    story:atlas:ascan-intro
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Schema / generator versions embedded in every manifest
# ---------------------------------------------------------------------------
SCHEMA_VERSION = "1.0"
GENERATOR_VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# Relationship types (evidence-aware)
# ---------------------------------------------------------------------------
RELATIONSHIP_TYPES = [
    "CONTAINS",
    "IMPORTS",
    "CALLS",
    "EXTENDS",
    "IMPLEMENTS",
    "DEPENDS_ON",
    "USES_API",
    "DOCUMENTS",
    "REFERENCES",
    "MODIFIED_BY",
    "INTRODUCED_BY",
    "PART_OF",
]

# Evidence types for relationship confidence
EVIDENCE_TYPES = ["syntactic", "inferred", "resolved"]

# ---------------------------------------------------------------------------
# ID helpers
# ---------------------------------------------------------------------------


def repo_id(name: str) -> str:
    return f"repo:{name}"


def module_id(repo: str, module: str) -> str:
    return f"module:{repo}:{module}"


def addon_id(name: str) -> str:
    return f"addon:{name}"


def file_id(repo: str, sha: str, path: str) -> str:
    return f"file:{repo}:{sha}:{path}"


def symbol_id(repo: str, qualified: str, member: str | None = None) -> str:
    if member:
        return f"symbol:{repo}:{qualified}#{member}"
    return f"symbol:{repo}:{qualified}"


def commit_id(repo: str, sha: str) -> str:
    return f"commit:{repo}:{sha}"


def branch_id(repo: str, name: str) -> str:
    return f"branch:{repo}:{name}"


def tag_id(repo: str, name: str) -> str:
    return f"tag:{repo}:{name}"


def contributor_id(repo: str, key: str) -> str:
    return f"contributor:{repo}:{key}"


def doc_id(repo: str, path: str) -> str:
    return f"doc:{repo}:{path}"


def story_id(story: str) -> str:
    return f"story:atlas:{story}"


# ---------------------------------------------------------------------------
# Entity dataclasses (plain data, serialization handled by chunks.py)
# ---------------------------------------------------------------------------


@dataclass
class Repository:
    id: str
    name: str
    url: str
    default_branch: str
    sha: str
    description: str = ""
    license: str = "Apache-2.0"


@dataclass
class Revision:
    id: str
    repository: str
    sha: str
    refs: list[str] = field(default_factory=list)


@dataclass
class Module:
    id: str
    repository: str
    name: str
    path: str
    kind: str = "gradle"
    addon: bool = False


@dataclass
class AddOn:
    id: str
    module: str
    name: str
    status: str = ""
    author: str = ""
    url: str = ""
    dependencies: list[str] = field(default_factory=list)


@dataclass
class Package:
    id: str
    module: str
    name: str
    path: str


@dataclass
class File:
    id: str
    module: str
    repository: str
    sha: str
    path: str
    language: str = "java"
    size: int = 0


@dataclass
class Symbol:
    id: str
    repository: str
    file: str
    qualified_name: str
    kind: str = "class"
    signature: str = ""
    start_line: int = 0
    end_line: int = 0
    resolution: str = "syntactic"
    annotations: list[str] = field(default_factory=list)  # best-effort qualified names


@dataclass
class Commit:
    id: str
    repository: str
    sha: str
    parents: list[str] = field(default_factory=list)
    author_name: str = ""
    author_date: str = ""
    committer_date: str = ""
    subject: str = ""
    message: str = ""
    branches: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)


@dataclass
class Branch:
    id: str
    repository: str
    name: str
    sha: str


@dataclass
class Tag:
    id: str
    repository: str
    name: str
    sha: str


@dataclass
class Contributor:
    id: str
    repository: str
    name: str
    email_norm: str


@dataclass
class Document:
    id: str
    repository: str
    module: str | None = None
    path: str = ""
    title: str = ""
    headings: list[str] = field(default_factory=list)
    anchors: list[str] = field(default_factory=list)
    language: str = "en"
    commit_count: int = 0
    last_changed: str | None = None
    commits: list[str] = field(default_factory=list)  # newest first, capped


@dataclass
class Milestone:
    id: str
    repository: str
    title: str
    description: str = ""
    date: str = ""
    commits: list[str] = field(default_factory=list)


@dataclass
class Story:
    id: str
    title: str
    description: str
    audience: str = ""
    chapters: list[dict] = field(default_factory=list)
    entities: list[str] = field(default_factory=list)
    commits: list[str] = field(default_factory=list)
    documents: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)


@dataclass
class Relationship:
    source: str
    target: str
    type: str
    repository: str
    source_revision: str | None = None
    evidence_type: str = "syntactic"
    confidence: float = 1.0
    source_file: str | None = None
    source_line: int | None = None
    valid_from: str | None = None
    valid_to: str | None = None


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


@dataclass
class DatasetInventory:
    name: str
    items: int
    size_bytes: int
    sha256: str


@dataclass
class Manifest:
    schema_version: str
    generator_version: str
    generated_at: str
    sources: list[dict]
    inventory: list[DatasetInventory]
    coverage: dict
    chunks: list[str]

