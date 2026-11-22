# ZAP Atlas

A static website for exploring the history, architecture, code and ecosystem of
ZAP. It is generated from three upstream repositories:

| Repository | Role |
|---|---|
| [zaproxy/zaproxy](https://github.com/zaproxy/zaproxy) | ZAP core |
| [zaproxy/zap-extensions](https://github.com/zaproxy/zap-extensions) | Add-ons |
| [zaproxy/zap-core-help](https://github.com/zaproxy/zap-core-help) | Core help |

There is no backend, database or external service. A Python generator analyses
the repositories into chunked JSON/JSONL files; a React app loads them on demand.
Source code is never copied: pages link to GitHub at the exact pinned commit.

## What is in it

- **Git history:** every commit reachable from any ref, with parents (merges
  included), branches, tags, changed files and renames. Sharded per repository
  and year, and loaded one shard at a time.
- **Java code:** types, methods, constructors, fields and nested types from
  Tree-sitter, with overload-safe ids and `CONTAINS`, `IMPORTS`, `EXTENDS`,
  `IMPLEMENTS` and `CALLS` edges.
- **Ecosystem:** Gradle modules, add-ons (status, author, dependencies) and
  English help pages, with links between pages and per-page history.
- **Languages:** files and lines per language, so help HTML is counted as content.
- **Search:** a static MiniSearch index, loaded per group on first use.
- **Stories:** curated, evidence-backed narratives in [`stories/`](stories/README.md).
  Each cited commit, entity and document is checked against the dataset.

Every relationship records how it was established: `resolved`, `inferred` or
`syntactic`. A call expression is never labelled resolved unless it is.

## Layout

```
atlas/              Python generator (analysis, sharding, search index, validation, report)
frontend/           React + TypeScript + Vite app, and Playwright smoke tests (e2e/)
stories/            Curated stories (JSON, one file per story)
tests/              Python tests; git and Gradle fixtures are built in conftest.py
.github/workflows/  Analyze, validate, build, smoke test, deploy
data/               Generated output (gitignored)
sources/            Upstream checkouts (gitignored)
```

## Local use

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install tree-sitter tree-sitter-java pytest

python -m atlas analyze --sources ./sources --output ./data   # clone/refresh, analyze, build search index
python -m atlas validate ./data --contract                    # data checks + files the frontend fetches
python -m atlas report ./data                                 # SHAs, sizes, coverage (Markdown)
python -m atlas index ./data                                  # rebuild only the search index
python -m pytest tests
```

A full run clones three repositories with complete history and takes about ten
minutes. `ATLAS_JAVA_MAX=100` limits Java files per repository for quick trials.

To run the site against the generated data:

```bash
cd frontend
npm ci
mkdir -p public && rm -rf public/data && cp -R ../data public/data
npm run dev                         # http://localhost:5173
```

For the production build, as deployed:

```bash
npm run build && cp -R ../data dist/data && npm run preview
npx playwright install chromium && npx playwright test   # browser smoke tests
```

`public/data` and `dist/data` are large; do not commit them.

## Deployment (GitHub Pages)

The workflow in `.github/workflows/deploy.yml` runs on manual dispatch and weekly
(Mondays 02:00 UTC). It checks out the upstream repositories, runs the generator,
validates, runs the tests, builds the frontend, runs the browser smoke tests and
deploys a Pages artifact. A failed step stops the run before the deploy, so the
last good site stays live. A newer run cancels one in progress.

**One-time setting:** Settings → Pages → Source → **GitHub Actions**.

Manual runs accept a `ref` (applies to every repository) or `repo_refs`, a JSON
map such as `{"zaproxy": "v2.16.1"}`, to analyze a specific branch, tag or SHA.
The site's base path is taken from the repository name, so it works under
`https://<owner>.github.io/<repo>/`. Deep links work because the build copies
`index.html` to `404.html`.

Actions are pinned to commit SHAs (the version is in a comment next to each).
The workflow needs no secrets; the upstream repositories are public.

## Data and privacy

- Email addresses are never published: author names, commit subjects and
  messages are scrubbed of email-shaped text, and contributors are keyed by a
  hash. The validator fails the build if one slips through.
- Commit messages and help content are untrusted. React escapes all rendered
  text, and external links are limited to `https`.
- Upstream source is parsed, never executed.

## Limitations

- **Structure is current, history is complete.** Modules, add-ons, help pages,
  Java symbols and relationships describe the checked-out revision only. Older
  layouts (for example the Ant era) are not reconstructed; their commits and file
  changes are in the history.
- **Calls are mostly not resolved.** Only receiver-less calls that match a method
  of the same type are recorded (a unique match is `resolved`, several same-arity
  overloads are `inferred`). All other call expressions are counted in the
  manifest and not emitted. No classpath-based semantic analysis is done.
- **Imports and inheritance** are resolved by qualified name against the declared
  types in the dataset; types outside it stay `syntactic`.
- **Search covers declared types**, not methods or fields.
- **Help is English only.** Locale packs are modules but their pages are not indexed.
- **Hand-curated stories are drafts** until a maintainer marks them `reviewed`.
- **zap-extensions history before 2016-03-23** has different commit SHAs than the
  ones GitHub recorded in older pull requests, which is consistent with a past
  history rewrite. Atlas links use the SHAs in the repository today.
- **Size.** The dataset is about 300 MB raw and 14 MB gzipped. Pages serves it
  gzipped, but the largest single files (`relationships/zap-extensions.jsonl`,
  59 MB raw) are slow to parse on first use.

Exact upstream SHAs, row counts, sizes and coverage for each build are in the
dataset report (`python -m atlas report`), which the workflow also writes to the
run summary.
