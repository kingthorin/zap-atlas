# ZAP Atlas

A static website for exploring the history, architecture, code and ecosystem of
ZAP. It is generated from six upstream repositories:

| Repository | Role |
|---|---|
| [zaproxy/zaproxy](https://github.com/zaproxy/zaproxy) | ZAP core |
| [zaproxy/zap-extensions](https://github.com/zaproxy/zap-extensions) | Add-ons |
| [zaproxy/zest](https://github.com/zaproxy/zest) | Zest, the graphical scripting language (Java) |
| [zaproxy/browser-extension](https://github.com/zaproxy/browser-extension) | Browser extension and Browser Recorder (TypeScript, history only) |
| [zaproxy/zap-core-help](https://github.com/zaproxy/zap-core-help) | Core help |
| [zaproxy/zap-hud](https://github.com/zaproxy/zap-hud) | Heads Up Display add-on |

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
python -m atlas validate ./data --contract                    # data and integrity checks (hashes, SHAs, shards, story text) + files the frontend fetches
python -m atlas inspect --entity addon:oast                      # one entity with its edges and citing stories (a bare name means an add-on)
python -m atlas history --repository zap-hud --year 2019           # commits by year, busiest months, authors, releases; --since, --path (follows renames)
python -m atlas report ./data                                 # SHAs, sizes, coverage (Markdown)
python -m atlas index ./data                                  # rebuild only the search index
python -m pytest tests
```

A full run over six repositories with complete history takes about a minute once
they are cloned (the first clone takes longer).
Runs are incremental. `atlas analyze` reads each repository's commit with `git ls-remote` first.
If every commit, the generator code and the stories match the dataset already in the output
directory, it stops (about 8 seconds). Otherwise a repository whose commit was parsed before is
replayed from `sources/.atlas-cache` without being cloned or parsed, and only repositories that
moved are processed. `--force` rebuilds everything. A run that writes a dataset also deletes the files an earlier run left in the generated data directories (`commits/`, `files/`, `symbols/`, `relationships/`, `incoming/`, `shards/`, `author_modules/`) or listed in the previous manifest; other files in the output directory are not touched. The CI workflow keeps that cache between runs. `ATLAS_JAVA_MAX=100` limits Java files per repository for quick trials.

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
map such as `{"zaproxy": "v2.16.1"}`, to analyze a specific branch, tag or SHA. They are passed to
`atlas analyze --ref` and `--repo-refs`, which do the cloning, so the same options work locally.
The site's base path is taken from the repository name, so it works under
`https://<owner>.github.io/<repo>/`. Deep links work because the build copies
`index.html` to `404.html`.

Actions are pinned to commit SHAs (the version is in a comment next to each).
The workflow needs no secrets; the upstream repositories are public.

## Logo and artwork

`frontend/public/logo.svg` (also the favicon) is a plain vector SVG with no embedded
bitmap. The lightning bolt is the geometry of the official ZAP logo as published in
[zaproxy.org/img/zap-by-checkmarx.svg](https://www.zaproxy.org/img/zap-by-checkmarx.svg)
(artwork repository: [zaproxy/zap-swag](https://github.com/zaproxy/zap-swag/tree/master/logos),
released under a Creative Commons licence). The globe is an orthographic projection of
the [Natural Earth](https://www.naturalearthdata.com/) 110m land polygons (public domain)
inside the logo's circle. The header colours come from zaproxy.org's stylesheet.

## Licence

The generator, frontend, tests and stories are under the [Apache License 2.0](LICENSE), as the
ZAP repositories are. The logo artwork keeps the licence described above, and the generated
dataset reproduces text, names and commit metadata from the upstream repositories, which carry
their own licences.

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
- **Calls are resolved by declared type and arity only.** A call is `resolved` when
  its receiver's declared type (local, parameter, field, `new`, static type name,
  `super`, or a statically imported member) is a type in the dataset with exactly
  one method of that name and arity, searching supertypes in the dataset;
  `inferred` when several match. A chained call `a().b()` is followed through the
  declared return types of the methods in the chain (each step must be a method in
  the dataset, and overloads are followed only if they declare the same return type);
  it is `resolved` only when every step had one candidate. There is no overload
  resolution beyond arity, no generics (a generic or type-variable return type ends
  the chain), and no `var`. Calls into libraries
  outside the dataset (JDK, Swing, JUnit), methods inherited from them, and
  unresolvable receivers are counted in the manifest, not emitted. A type name
  declared twice is never resolved.
- **Annotations** are recorded per symbol (qualified where an import shows it);
  `@Deprecated` is shown, a Javadoc `@deprecated` tag is not read.
- **`USES_API`** links an add-on module to the core types it imports; it comes from
  resolved imports only, so it misses references that need no import.
- **Imports and inheritance** are resolved by qualified name against the declared
  types in the dataset; types outside it stay `syntactic`.
- **Search covers declared types**, not methods or fields.
- **Help is English only.** Locale packs are modules but their pages are not indexed.
- **Hand-curated stories are drafts** until a maintainer marks them `reviewed`.
- **zap-extensions history before 2016-03-23** has different commit SHAs than the
  ones GitHub recorded in older pull requests, which is consistent with a past
  history rewrite. Atlas links use the SHAs in the repository today.
- **Size.** The dataset is about 370 MB raw. Symbols and relationships are sharded per
  module (`symbols/<repo>/<shard>.jsonl`, with `shards/<repo>.json` as the index; modules over
  about 3 MB split by directory), so the largest data file is about 3 MB. A symbol page loads
  its index (0.5 MB gzipped for zap-extensions) and one shard. Edges that reach a symbol from
  another shard are also written to `incoming/`. `atlas reshard <dataset>` rebuilds the shards
  from an existing dataset.

Exact upstream SHAs, row counts, sizes and coverage for each build are in the
dataset report (`python -m atlas report`), which the workflow also writes to the
run summary.
