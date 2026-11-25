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
- Architecture graph with drill-down: done as the Graph page (modules, expandable into types, files and directories) and the Source page's module links.
- Validation: done in `atlas/integrity.py` (manifest hashes and sizes, unlisted files, schema version and required fields, pinned 40-character SHAs and revision references, relative paths, shard indexes against shard files, story text artefacts). Open: stricter per-field types, and checking quoted text against CHANGELOGs and source files (only commit subjects can be checked from the dataset, and that is a warning).
- `atlas inspect` is done (`--entity <id>`, `--dataset`, `--limit`: the row, its edges by type and evidence, the shard it came from, add-on dependencies and releases, module languages and links, and citing stories; a bare name means an add-on). `atlas history --repository <name>` is done too: commits by year, releases, busiest months and top contributors, with `--year`, `--since` and `--path` (file history).
- Accessibility audit: first pass done. axe (WCAG 2.1 A and AA) passes on 15 pages in both themes, and no page scrolls sideways at 390 px (both run in `e2e/audit.spec.ts`). Not covered: a keyboard-only walkthrough, screen reader testing, and a contrast check of the graph canvas labels in dark mode (they now have an outline in the page colour, but it has not been measured).
- Licence file and attribution notices for the Atlas repository: done. `LICENSE` is Apache 2.0, and the README says the logo artwork and the upstream-derived data keep their own licences. No copyright holder or per-file headers yet.
- Performance: symbols and relationships are sharded per module (done); the module graph is `module_graph.json` (about 40 KB). Remaining: the shard index for zap-extensions is 5 MB raw (0.5 MB gzipped).
- Least privilege: the analyze job no longer overrides to `contents: write` (done, CI passed without it).

## Interactive resources (built)

1. **Zoomable timeline** (done: `timeline.json` monthly commits and active authors per repo, weekly bars from the year shards when zoomed in, hover tooltips, core and HUD release lines, story markers, a strip of add-on releases under each lane that opens the Releases page for that repository and period, table alternative; line counts are in: Lines added and Lines deleted per month or week, from each commit's totals; a Focus selector shows one module's own monthly activity (commits, authors, lines) with only that add-on's releases, on current paths so moved files keep their history, with no weekly detail; a Core team lane built from the history of the help credits page (each person is listed from the first version of the page that names them until the first later one that does not; names only, rows with email addresses are skipped, aliases are merged), and story diamonds coloured by group, which marks the student projects and are packed into rows by screen position so none sits on another; repository checkboxes (kept in the URL as `?hide=`); and a Select range toggle (or Shift+drag) that zooms to the dragged range. The Focus selector also offers directories (to depth 4, at least 50 commits) and languages, monthly only and without the add-on release strip (`timeline_sections.json`). The Hall of Fame list itself is not in the data, only the projects that have stories). Original design: four repositories stacked. A small precomputed
   monthly aggregate (commits, lines added and removed, active contributors) per repo
   and module or add-on; zooming below a month loads the per-year commit shards.
   Sub-section selector (repo, add-on, language, path prefix). Overlays: release tags,
   story milestones, Hall of Fame projects, core-team changes. Stories can link to a
   range or module.
2. **Weighted graph explorer (GitNexus-style)** (done: module-level graph from `module_graph.json` with Sigma.js, Graphology and ForceAtlas2, edge-type filters, neighbour table and module picker; module expansion into its 40 most connected types, a year slider, recency colouring, size by commits or lines changed, and an evidence filter are done; a module can also be expanded into its 40 most connected files with their directories; activity follows renames, so moved files and modules keep their earlier history; a tree beside the graph lists the modules and the files, directories or types of expanded ones and works by keyboard; a language filter (modules where the language is at least 20% of their lines), colour by main language, a repository filter and a find box are done; help pages are shown as files of a module expanded into files, linked by REFERENCES (the 20 most linked, added to the 40 source files; other non-Java files have no relationships and are not shown); open: a sunburst view). A force-directed knowledge graph of
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
   A hierarchical sunburst stays an optional second view of the same data. The Graph page also has the sweep through time (below).
3. **Add-on dependency network**: done as the Graph page's "Add-on dependencies" view (only `DEPENDS_ON` edges, drawn as arrows from an add-on to what it depends on, modules with no dependency edge dropped, size by how many add-ons depend on a module); the Source page's dependency table links to it. The **core-team swimlane** is done, on the timeline.

Built with D3 modules for scales, zoom, brush and hierarchy, rendered as SVG by React
(canvas past about 5,000 shapes).

## Ideas agreed with the maintainer (all four done)

1. **Timeline: repository checkboxes.** Show or hide each repository's lane; at least one stays visible; the choice is in the URL as `?hide=`.
2. **Timeline: select a range to zoom.** Shift+drag selects a range, and the Select range toggle next to the zoom buttons makes a plain drag select instead of pan (it works by touch). A translucent band shows the range; releasing zooms to it.
3. **Full-width mode.** A bold button with an icon above the page content (not in the header, so the navigation does not jump), shown from 1352 px wide on Graph, Timeline, Source, Releases and History; remembered in the browser. Stories and help pages stay narrow for reading.
4. **Graph: sweep through time.** A Play/Pause control, a month slider (from the first contribution) and speed (0.5x to 4x) under the graph, using `author_modules/<year>.json` (0.6 MB in all). Each month the top 8 people by commits, anyone matching "Always show", and everyone else pooled as "Other" fly in, wait on a ring outside the graph (it zooms out a little on first use to make room), fire pulses inwards at the modules they touched, and leave. A hit module shows its name, and each dot carries its person's name. Pausing keeps the frame. Bots are off unless "Include bots" is ticked. When the card is 820 px wide or more (needs full-width mode) a names column appears beside the graph. The reduced-motion setting turns the animation off and leaves the text summary. Open: the Timeline does not link to it, and author aliases are not merged.

## Options (not agreed, not started)

Ideas from a Gemini list (written from the project description; it could not open the site), reduced to what is not already built. Order is not priority. "Needs" says what data or work each depends on.

**Graph and code**
- **Evidence in the line style:** draw resolved edges solid, inferred dashed and syntactic dotted. The evidence filter exists; the style does not. Small.
- **Pathfinding:** pick two nodes (modules, types, add-ons) and show the shortest or typed path between them, respecting the evidence filter. Medium; the data is there.
- **Focus mode:** lock a centre node, expand 1 or 2 hops on demand, and hide high-degree utility types and syntactic edges. Expansion into types and files exists; hops and pinning do not.
- **Extension-point map:** choose a core class or interface (ExtensionAdaptor, AbstractPlugin and so on) and list every add-on that extends or implements it, grouped by add-on status. Cross-repository `EXTENDS` and `IMPLEMENTS` edges are in the data. Medium.
- **Blast radius:** from an add-on or module, highlight everything that depends on it, and everything it depends on, through all levels. The dependency view shows direct links only. Small to medium.
- **Help-page graph:** hubs, dead ends and cross-add-on help links, from the help link graph that is in the data but not drawn. Medium.

**Timeline and history**
- **Spike to graph:** click a burst of activity on the Timeline and open the Graph with the modules touched in that window highlighted. Needs a link format; the activity data exists. Medium.
- **Core to add-on migration view:** how much code and how many help pages sat in core and in add-ons over the years, as stacked areas; also languages over time as a streamgraph. Needs a new aggregate; the language focus exists but not the stacked view. Medium.
- **Add-on lifecycle:** alpha, beta, release and retired over time. Needs add-on status per release (changelogs and manifests), which the dataset has only for the current revision. Larger (touches M5).
- **File lineage:** the rename-aware path history of a file, class or help page, with files that often change together. History follows renames; there is no lineage page. Medium.
- **Code and docs drift:** align commits to an add-on's code against commits to its help pages, and flag heavy code change with no doc change. Both histories exist. Medium.
- **Added and removed connections over time:** the Graph's year slider fades by first and last activity only. Showing links as they appear and disappear needs the M5 historical analysis (symbol events and snapshots).

**Stories**
- **Scrollytelling:** a story reader with a sticky side panel that follows the chapter (the commit, the module, the help page). Medium to large.
- **Evidence drawer:** click a citation to open a panel with the commit's details, parents and tags, and the GitHub permalink, without leaving the story. Small to medium.
- **Shareable trails:** pin 3 to 8 entities with notes into a URL-encoded trail to share. Medium.

**Tools**
- **Search prefixes:** `t:` types, `a:` add-ons, `c:` commits, `h:` help pages, from a Cmd/Ctrl+K palette. Search groups exist; the prefixes and the shortcut do not. Small.
- **Copy for GitHub:** a button on a type, commit or add-on that copies a Markdown block (name, owner, status, permalink). Small.
- **SQL console:** DuckDB-Wasm over the shards, loaded only when opened. Heavy download and the shards are large; low priority.

## Page improvements (from review)

- **Repositories:** done. A repository with more than 5 modules folds its module list behind "Modules (N)"; the stats and language bars stay visible.
- **Stories:** done. One flat list with a group tag on each card (no group headings), a group filter, and a sort by date or title, ascending or descending.
- **Source and Architecture:** merged into one Source page (done): module and directory tree on the left, tabs for module links (from `module_graph.json`), symbols, relationships and add-on dependencies. Each module loads only its own shards. Open: file-level pages with history (the drawn graph is the Graph page).

## Stories: the plan and what is left

- Per-project stories for every Student Hall of Fame entry (2012 to 2023), each with
  its arc: first commit, enhancements, moves, current state.
- Feature stories: Spider, Passive Scan, Params, Encoder, Network, Exim, Reports,
  dark mode and themes, Docker images, the Automation Framework, authentication
  (Auth Helper, browser-based and client-script authentication, TOTP, OAuth, assisted auth).

- **Release and tag milestones** (done: `milestones.jsonl`, the Releases page, history markers, add-on release lists and story references). Link releases and tags (zaproxy `v2.x`, weekly tags,
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

1. Stories: 29 of 47 are marked `reviewed` (20 projects, 6 history, 3 features). 18 remain draft: 12 features, 4 projects and 2 history. Review is done by the maintainer; stories are never regenerated, but a story whose cited entity disappears upstream fails the build.
2. M3 remainder: a compiler-backed pass for overloads, generics and chained calls (optional).
3. ~~Release and tag milestones~~ (done: `milestones.jsonl`, Releases page, history markers, add-on release lists, story references).
4. ~~Timeline~~, ~~graph explorer~~ and the four agreed ideas (all done).
5. ~~Per-module shards~~, ~~workflow `ref` and `repo_refs` inputs~~ (now passed to `atlas analyze --ref/--repo-refs`; `checkout_sources.py` removed; CI passed with empty inputs and with `repo_refs` set to zap-hud v0.19.0),  ~~licence~~, ~~validator integrity checks~~, ~~zap-hud as a fourth repository~~, ~~accessibility first pass~~, ~~least-privilege CI~~ (all done).
6. Open, roughly in order of value:
   - Graph: the plan is done apart from the optional sunburst view (and non-Java files other than help pages).
   - Keyboard-only and screen reader accessibility testing, including the graph canvas.
   - M5 historical analysis and the optional M3 compiler-backed pass.
   - The options listed above, starting with the small ones.
