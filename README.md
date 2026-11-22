# ZAP Atlas

Static-hosted interactive visualization and exploration application for the ZAP
ecosystem:

- `zaproxy/zaproxy` — ZAP core
- `zaproxy/zap-extensions` — add-ons
- `zaproxy/zap-core-help` — core help / documentation

**Repository identity and Pages base path are configurable** (see
`atlas/config.py` and `frontend/vite.config.ts`) because the Atlas repository
owner/name is not yet decided.

## What it does

- Discovers each upstream default branch dynamically (never assumes `main`).
- Checks out full (non-shallow) Git history: commits, merge parents, branches,
  tags, changed paths, change types, add/delete/modify/rename statistics.
- Parses Java with Tree-sitter: packages, imports, classes/interfaces/enums/
  records, methods, fields, annotations, inheritance, method calls, source
  locations.
- Discovers Gradle modules/add-ons, parses `ZapAddOn.xml` and JavaHelp docs
  (core + add-on `src/main/javahelp`).
- Generates versioned, chunked JSON/JSONL static data + a manifest (schema/
  generator versions, source URLs + exact SHAs, refs, inventory, sizes,
  content hashes, coverage, limitations).
- Validates IDs, relationship endpoints, commit parents, paths, manifest
  hashes, privacy (no raw contributor emails), exact-revision GitHub links.
- React + TypeScript + Vite frontend: ecosystem overview, repository landscape,
  architecture explorer, Git history explorer, source explorer, search, curated
  stories. Deep links + exact-revision GitHub links.
- GitHub Actions: `workflow_dispatch` + weekly schedule, full-history checkout,
  generator → validate → frontend build → deploy to `gh-pages` root. A failed
  build never replaces the last successful site.

## Repository layout

```
atlas/              Python generator package
frontend/           React + TypeScript + Vite app
tests/              Python tests + git fixtures
.github/workflows/  CI + deploy to gh-pages
data/               generated static output (gitignored)
sources/            upstream checkouts (gitignored)
.venv/              Python virtualenv (gitignored)
```

## Local commands

Create and activate the virtualenv:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install tree-sitter tree-sitter-java pytest
```

### 1. Check out / refresh the upstream sources

```bash
python -m atlas analyze --sources ./sources --output ./data
```

This clones the three upstream repositories (full history) into `./sources`,
resolves each default branch dynamically, records the exact full SHA, then runs
analysis and generation into `./data`.

### 2. Validate generated data

```bash
python -m atlas validate ./data
```

Checks unique IDs, relationship endpoints, commit parents, paths, source
revision references, manifest hashes, schema compatibility, privacy rules, and
exact-revision GitHub links.

### 3. Inspect an entity / history summary

```bash
python -m atlas inspect --entity addon:ascanrules
python -m atlas history --repository zap-extensions
```

### 4. Run the test suite

```bash
python -m pytest tests/
```

### 5. Build the frontend

```bash
cd frontend
npm install      # (or npm ci)
npm run build    # -> frontend/dist/
```

The app shell gzips to well under 1 MB.

## Deployment (GitHub Pages)

The `.github/workflows/deploy.yml` workflow runs on `workflow_dispatch` and a
weekly schedule. It dynamically discovers each upstream default branch (or uses
supplied ref/SHA overrides), does full-history checkouts, runs the generator,
validates the data, builds the frontend, bundles `data/` into `frontend/dist/`,
and deploys **directly to the `gh-pages` branch at its root**.

### Required Pages setting (repository owner)

In the Atlas repository on GitHub, go to **Settings → Pages** and set:

- **Build and deployment → Source**: **Deploy from a branch**
- **Branch**: `gh-pages` / **(root)**

The `gh-pages` branch contains **only** generated static output — no generator
source or development infrastructure. A failed workflow run stops before the
deploy step, so the last successful site on `gh-pages` is preserved.

### Permissions

The workflow uses `GITHUB_TOKEN` with `contents: write` (needed to push to
`gh-pages`). Public upstream repositories are read anonymously — no secrets are
required just to read them.


## Data model

Versioned schema (see `atlas/schema.py`) with repository-qualified, globally
unique IDs:

- `repo:zaproxy`, `module:zap-extensions:addOns/ascanrules`,
  `addon:ascanrules`, `file:zaproxy:<sha>:<path>`,
  `symbol:zaproxy:org.zaproxy.zap.Extension#getMainUI()`,
  `commit:zaproxy:<full-sha>`, `branch:zaproxy:main`, `tag:zaproxy:v2.14.0`,
  `contributor:zaproxy:<key>`, `doc:zap-core-help:...`,
  `story:atlas:<slug>`

Relationships (`CONTAINS`, `IMPORTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`,
`DEPENDS_ON`, `USES_API`, `DOCUMENTS`, `REFERENCES`, `MODIFIED_BY`,
`INTRODUCED_BY`, `PART_OF`) record source/target IDs, type, repository, source
revision, evidence type (`syntactic` / `inferred` / `resolved`), confidence,
source file/line, and historical validity. Inferred edges are distinguishable
from resolved edges.

## Curated stories

Human-authored, evidence-backed stories render at `/stories`. Automated
milestones may suggest material, but only human-reviewed stories are presented
as authoritative narratives. No events, motivations, dates, or causal claims
are invented.

## Known limitations (MVP)

- Real-data generation on the full `zaproxy` history is heavy; CI runs it
  weekly. A vertical-slice demo is validated with git fixtures.
- Semantic resolution is syntactic in this MVP; progressive JavaParser /
  compiler-backed resolution is planned.
- Raw contributor emails are never published (normalized identifiers only).
- Graph rendering uses a relationship table in the MVP; Cytoscape.js / Sigma.js
  integration is a planned enhancement.

## Security & licensing

No secrets, tokens, or environment variables are published. No upstream source
is executed. No external runtime service or LLM API is used. Third-party
dependencies retain their licenses and attribution.

