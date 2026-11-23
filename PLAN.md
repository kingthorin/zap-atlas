# ZAP Atlas plan and status

The original brief is the agent handoff (milestones M0 to M6 and a definition of
done). This file tracks where the project stands against it, where it deliberately
differs, and what is planned next. Update it with each change that moves an item.

## Deviations from the handoff

| Handoff | What we did | Why |
|---|---|---|
| Publish a generated site to a `gh-pages` branch | Deploy a GitHub Pages artifact | `files.jsonl` exceeded GitHub's 100 MB file limit; Pages artifacts have no per-file limit. Decided with the maintainer. |
| Data chunked by repository, module and time | Commits and file changes by repo and year; symbols and relationships by module (modules over 3 MB split by directory); small chunks flat | Done: largest data file is about 3 MB. |
| Three source repositories | Three, plus `zap-hud` as an optional fourth (not added) | The HUD lives in its own repository. |
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
| M6 Polish | In progress | Search, stories, README, smoke tests done. Accessibility audit, performance work and licensing open. |

## Definition of done: open items

- Entities `Revision`, `Package` and `Milestone`; file entities for every tracked file, not only changed ones.
- Repository landscape (repo, module, package, file hierarchy with size and activity).
- Source explorer file page with file history.
- Architecture graph with drill-down (the current explorer is tables).
- Validation: manifest hashes, paths, source-revision references, schema compatibility, pinned GitHub URLs.
- `atlas inspect` and `atlas history` commands (stubs today).
- Accessibility audit: contrast in both themes, keyboard paths, reduced motion, text alternatives for charts.
- Licence file and attribution notices for the Atlas repository.
- Performance: symbols and relationships are sharded per module (done); the module graph is `module_graph.json` (24 KB). Remaining: the shard index for zap-extensions is 5 MB raw (0.5 MB gzipped).
- Least privilege: the analyze job does not need `contents: write`.

## Planned: interactive resources

1. **Zoomable timeline** (first version done: `timeline.json` monthly commits and active authors per repo, weekly bars from the year shards when zoomed in, release and story markers, table alternative; open: line counts, sub-section selector, Hall of Fame and core-team overlays; the generator never records `additions`/`deletions`, they are 0 in every file change). Three repositories stacked or overlaid. A small precomputed
   monthly aggregate (commits, lines added and removed, active contributors) per repo
   and module or add-on; zooming below a month loads the per-year commit shards.
   Sub-section selector (repo, add-on, language, path prefix). Overlays: release tags,
   story milestones, Hall of Fame projects, core-team changes. Stories can link to a
   range or module.
2. **Weighted graph explorer (GitNexus-style).** A force-directed knowledge graph of
   all three repositories together, rendered with WebGL (Sigma.js and Graphology, both
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
3. **Add-on dependency network** and a **core-team swimlane** from the credits history.

Built with D3 modules for scales, zoom, brush and hierarchy, rendered as SVG by React
(canvas past about 5,000 shapes).

## Planned: page improvements (from review)

- **Repositories:** make the module cards expandable. When a repository has more than 5 modules, collapse everything below the summary stats and bar chart behind an expand/collapse control.
- **Stories:** sort control for A to Z, Z to A, date ascending and date descending.
- **Source and Architecture:** merged into one Source page (done): module and directory tree on the left, tabs for module links (from `module_graph.json`), symbols, relationships and add-on dependencies. Each module loads only its own shards. Open: file-level pages with history, a drawn graph (the graph explorer).

## Planned: stories

- Per-project stories for every Student Hall of Fame entry (2012 to 2023), each with
  its arc: first commit, enhancements, moves, current state.
- Feature stories: Spider, Passive Scan, Params, Encoder, Network, Exim, Reports,
  dark mode and themes, Docker images, the Automation Framework, authentication
  (Auth Helper, browser-based and client-script authentication, TOTP, OAuth, assisted auth).
- Open ideas: an optional `zap-hud` source repository so HUD commits can be cited.

- **Release and tag milestones.** Link releases and tags (zaproxy `v2.x`, weekly tags,
  zap-extensions per-add-on release tags, zap-core-help) to the history explorer, the
  stories and the timeline: a `Milestone` entity per release with its date, tag, commit
  and release-notes page, shown as markers on the timeline and the history view, and
  citable from story chapters (replacing hand-written release dates). Tags are already
  in the dataset (`tags.jsonl`); milestones need the release-note pages and a rule for
  which tags count as releases (skip weekly and RC tags by default).

## Next

1. Review the draft stories with the maintainers and mark them `reviewed`.
2. M3 remainder: a compiler-backed pass for overloads, generics and chained calls (optional).
3. ~~Release and tag milestones~~ (done: `milestones.jsonl`, Releases page, history markers, add-on release lists, story references).
4. ~~Timeline~~ (first version done), then the graph explorer.
5. ~~Per-module shards~~ (done). The graph explorer; accessibility audit; licence.
