# ZAP Atlas plan and status

The original brief is the agent handoff (milestones M0 to M6 and a definition of
done). This file tracks where the project stands against it, where it deliberately
differs, and what is planned next. Update it with each change that moves an item.

## Deviations from the handoff

| Handoff | What we did | Why |
|---|---|---|
| Publish a generated site to a `gh-pages` branch | Deploy a GitHub Pages artifact | `files.jsonl` exceeded GitHub's 100 MB file limit; Pages artifacts have no per-file limit. Decided with the maintainer. |
| Data chunked by repository, module and time | Commits and file changes by repo and year; symbols and relationships by module (modules over 3 MB split by directory); small chunks flat | Done: largest data file is about 3 MB. |
| Three source repositories | Four: `zap-hud` is added | The HUD lives in its own repository. It is a single-project Gradle repo, so its `src` directory is its one module. |
| Stories are curated | Curated JSON, status `draft` or `reviewed`; drafts are labelled | Only maintainer-reviewed stories should read as authoritative. |

## Milestones

| | Status | Notes |
|---|---|---|
| M0 Reconnaissance | Done | Layout, history volume, Gradle and help locations are reflected in the generator and README. |
| M1 Static foundation | Done | Schema, CLI, validator, frontend shell, Pages deployment, CI with tests and browser smoke tests. |
| M2 Git history | Done | Full DAG, refs, tags, file changes, renames, year shards, timeline-ready data. |
| M3 Code intelligence | Mostly done | Types, members, annotations, imports, inheritance, calls resolved by declared type and arity (including supertypes and static imports), `USES_API`. Open: overload resolution beyond arity, generics, `var` and chained calls (a compiler-backed pass), Javadoc `@deprecated`. |
| M4 Ecosystem | Mostly done | Modules, add-ons, dependencies, help pages, help link graph, per-page history, languages. Open: JavaHelp navigation (`toc.xml`, `index.xml`, `map.jhm`), core API links. |
| M5 Historical analysis | Not started | Symbol events, snapshots, `MODIFIED_BY`, `INTRODUCED_BY`, `PART_OF`, automated milestone suggestions. Current structure only today. |
| M6 Polish | Mostly done | Search, stories, README, smoke tests, Apache 2.0 licence, per-module shards and a first accessibility pass (axe in both themes, phone width) are done. Open: keyboard-only and screen reader testing, licence headers in source files if wanted. |

## Definition of done: open items

- Entities `Revision`, `Package` and `Milestone`; file entities for every tracked file, not only changed ones.
- Repository landscape (repo, module, package, file hierarchy with size and activity).
- Source explorer file page with file history.
- Architecture graph with drill-down: done as the Graph page (modules, expandable into types) and the Source page's module links. Open: files and directories as nodes.
- Validation: done in `atlas/integrity.py` (manifest hashes and sizes, unlisted files, schema version and required fields, pinned 40-character SHAs and revision references, relative paths, shard indexes against shard files, story text artefacts). Open: stricter per-field types, and checking quoted text against CHANGELOGs and source files (only commit subjects can be checked from the dataset, and that is a warning).
- `atlas inspect` is done (`--entity <id>`, `--dataset`, `--limit`: the row, its edges by type and evidence, the shard it came from, add-on dependencies and releases, module languages and links, and citing stories; a bare name means an add-on). `atlas history` is still a stub. Planned: `history --repository <name>` prints commits by year, releases, busiest months and top contributors, with `--year`, `--since` and `--path` (file history).
- Accessibility audit: first pass done. axe (WCAG 2.1 A and AA) passes on 15 pages in both themes, and no page scrolls sideways at 390 px (both run in `e2e/audit.spec.ts`). Not covered: a keyboard-only walkthrough, screen reader testing, and contrast of the graph canvas labels in dark mode.
- Licence file and attribution notices for the Atlas repository: done. `LICENSE` is Apache 2.0, and the README says the logo artwork and the upstream-derived data keep their own licences. No copyright holder or per-file headers yet.
- Performance: symbols and relationships are sharded per module (done); the module graph is `module_graph.json` (24 KB). Remaining: the shard index for zap-extensions is 5 MB raw (0.5 MB gzipped).
- Least privilege: the analyze job no longer overrides to `contents: write` (done, CI passed without it).

## Planned: interactive resources

1. **Zoomable timeline** (first version done: `timeline.json` monthly commits and active authors per repo, weekly bars from the year shards when zoomed in, hover tooltips, core and HUD release lines, story markers, a strip of add-on releases under each lane that opens the Releases page for that repository and period, table alternative; line counts are in: Lines added and Lines deleted per month or week, from each commit's totals; a Focus selector shows one module's own monthly activity (commits, authors, lines) with only that add-on's releases, on current paths so moved files keep their history, with no weekly detail. a Core team lane built from the history of the help credits page (each person is listed from the first version of the page that names them until the first later one that does not; names only, rows with email addresses are skipped, aliases are merged), and story diamonds coloured by group, which marks the student projects. Open: a path-prefix or language sub-section; the Hall of Fame list itself is not in the data, only the projects that have stories). Four repositories stacked. A small precomputed
   monthly aggregate (commits, lines added and removed, active contributors) per repo
   and module or add-on; zooming below a month loads the per-year commit shards.
   Sub-section selector (repo, add-on, language, path prefix). Overlays: release tags,
   story milestones, Hall of Fame projects, core-team changes. Stories can link to a
   range or module.
2. **Weighted graph explorer (GitNexus-style)** (first version done: module-level graph from `module_graph.json` with Sigma.js, Graphology and ForceAtlas2, edge-type filters, neighbour table and module picker; module expansion into its 40 most connected types, a year slider, recency colouring, size by commits or lines changed, and an evidence filter are done; a module can also be expanded into its 40 most connected files with their directories; activity follows renames, so moved files and modules keep their earlier history; a tree beside the graph lists the modules and the files, directories or types of expanded ones and works by keyboard; a language filter (modules where the language is at least 20% of their lines), colour by main language, a repository filter and a find box are done; open: files for non-Java sources, a sunburst view). A force-directed knowledge graph of
   all four repositories together, rendered with WebGL (Sigma.js and Graphology, both
   MIT; GitNexus itself is PolyForm Noncommercial, so we take the idea, not its code).
   - Nodes: repositories, modules and add-ons, directories, files, types, and
     optionally methods. Size by lines, commits (churn) or relationship count; colour
     by repository or language, with a recency mode.
   - Edges: the relationships we already have (`CALLS`, `IMPORTS`, `EXTENDS`,
     `IMPLEMENTS`, `USES_API`, `DEPENDS_ON`, `REFERENCES`, `DOCUMENTS`), styled by type
     and by evidence level (resolved, inferred, syntactic), filterable.
   - Scale: 511,000 entities will not fit on screen, so start at module level (about 130
     modules, edges aggregated from calls, imports, `USES_API` and `DEPENDS_ON`) and
     expand a module into its files and types on click; aggregate small clusters and
     keep a level-of-detail cap per view.
   - Interaction: click to inspect and open the symbol, module or help page; neighbour
     highlight; search; filter by repo, language, relationship type and evidence; a
     file tree beside it; a year slider that fades nodes by first and last activity.
   - Accessibility: a keyboard-navigable list and a table of the selected node's
     neighbours alongside the canvas.
   - Data: a per-module aggregate edge file and per-module node files, so a view loads
     only what it shows (this also motivates per-module shards).
   A hierarchical sunburst stays an optional second view of the same data.
3. **Add-on dependency network**: done as the Graph page's "Add-on dependencies" view (only `DEPENDS_ON` edges, drawn as arrows from an add-on to what it depends on, modules with no dependency edge dropped, size by how many add-ons depend on a module); the Source page's dependency table links to it. The **core-team swimlane** is done, on the timeline.

Built with D3 modules for scales, zoom, brush and hierarchy, rendered as SVG by React
(canvas past about 5,000 shapes).

## Planned: page improvements (from review)

- **Repositories:** done. A repository with more than 5 modules folds its module list behind "Modules (N)"; the stats and language bars stay visible.
- **Stories:** done. One flat list with a group tag on each card (no group headings), a group filter, and a sort by date or title, ascending or descending.
- **Source and Architecture:** merged into one Source page (done): module and directory tree on the left, tabs for module links (from `module_graph.json`), symbols, relationships and add-on dependencies. Each module loads only its own shards. Open: file-level pages with history, a drawn graph (the graph explorer).

## Planned: stories

- Per-project stories for every Student Hall of Fame entry (2012 to 2023), each with
  its arc: first commit, enhancements, moves, current state.
- Feature stories: Spider, Passive Scan, Params, Encoder, Network, Exim, Reports,
  dark mode and themes, Docker images, the Automation Framework, authentication
  (Auth Helper, browser-based and client-script authentication, TOTP, OAuth, assisted auth).

- **Release and tag milestones.** Link releases and tags (zaproxy `v2.x`, weekly tags,
  zap-extensions per-add-on release tags, zap-core-help) to the history explorer, the
  stories and the timeline: a `Milestone` entity per release with its date, tag, commit
  and release-notes page, shown as markers on the timeline and the history view, and
  citable from story chapters (replacing hand-written release dates). Tags are already
  in the dataset (`tags.jsonl`); milestones need the release-note pages and a rule for
  which tags count as releases (skip weekly and RC tags by default).

## Stories added from the maintainer's list

Three draft history stories, written from the dataset and public records (GitHub API, the registry's RDAP record, the Internet Archive):
`zapbot` (account created 2015-06-04; what it commits since 2015-11-10), `zap-logo` (the logo notes, the November 2017 icons, the 2024 ZAP by Checkmarx banner)
and `zap-website` (domain registered 2015-11-04, the Hugo site, January 2020). They are `draft` until a maintainer reviews them.

## Incremental runs

`atlas analyze` skips unchanged work: the whole run when the upstream commits, generator code and stories match the output
dataset, and per repository when only some moved (`sources/.atlas-cache`, one entry per repository, keyed by commit and
generator code). CI restores that cache with `actions/cache`. Measured locally with only zap-extensions moved: 70 seconds
against 84 for a full run, output identical for all 673 files; the saving in CI is mostly the clones of the three quiet repositories.

## Next

1. Stories: 24 of 41 are marked `reviewed` (19 projects and 5 history). 17 remain draft: the 11 feature stories, plus BIRT reporting, CMS scanner, bug tracker, Authentication helper and DOM XSS scanner.
2. M3 remainder: a compiler-backed pass for overloads, generics and chained calls (optional).
3. ~~Release and tag milestones~~ (done: `milestones.jsonl`, Releases page, history markers, add-on release lists, story references).
4. ~~Timeline~~ (first version done), ~~graph explorer~~ (module level and type expansion done).
5. ~~Per-module shards~~, ~~workflow `ref` and `repo_refs` inputs~~ (now passed to `atlas analyze --ref/--repo-refs`; `checkout_sources.py` removed; CI passed with empty inputs and with `repo_refs` set to zap-hud v0.19.0),  ~~licence~~, ~~validator integrity checks~~, ~~zap-hud as a fourth repository~~, ~~accessibility first pass~~, ~~least-privilege CI~~ (all done).
6. Open, roughly in order of value:
   - Graph: the plan is done apart from files for non-Java sources and the optional sunburst view.
   - Timeline extras: a path-prefix or language sub-section (the add-on focus, core team lane and project markers are done).
   - Keyboard-only and screen reader accessibility testing, including the graph canvas.
   - M5 historical analysis and the optional M3 compiler-backed pass.
