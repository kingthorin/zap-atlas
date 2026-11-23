# ZAP Atlas plan and status

The original brief is the agent handoff (milestones M0 to M6 and a definition of
done). This file tracks where the project stands against it, where it deliberately
differs, and what is planned next. Update it with each change that moves an item.

## Deviations from the handoff

| Handoff | What we did | Why |
|---|---|---|
| Publish a generated site to a `gh-pages` branch | Deploy a GitHub Pages artifact | `files.jsonl` exceeded GitHub's 100 MB file limit; Pages artifacts have no per-file limit. Decided with the maintainer. |
| Data chunked by repository, module and time | Commits and file changes by repo and year; symbols and relationships by repo; small chunks flat | Enough for lazy loading so far. Per-module shards are still open (see backlog). |
| Three source repositories | Three, plus `zap-hud` as an optional fourth (not added) | The HUD lives in its own repository. |
| Stories are curated | Curated JSON, status `draft` or `reviewed`; drafts are labelled | Only maintainer-reviewed stories should read as authoritative. |

## Milestones

| | Status | Notes |
|---|---|---|
| M0 Reconnaissance | Done | Layout, history volume, Gradle and help locations are reflected in the generator and README. |
| M1 Static foundation | Done | Schema, CLI, validator, frontend shell, Pages deployment, CI with tests and browser smoke tests. |
| M2 Git history | Done | Full DAG, refs, tags, file changes, renames, year shards, timeline-ready data. |
| M3 Code intelligence | Partial | Types, members, imports, inheritance, same-type call resolution. Open: annotations, `USES_API`, semantic resolution across types. |
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
- Performance: the largest zap-extensions shards (relationships 59 MB, symbols 30 MB raw) exceed the "module graph under 1 MB" goal; shard per module.
- Least privilege: the analyze job does not need `contents: write`.

## Planned: interactive resources

1. **Zoomable timeline.** Three repositories stacked or overlaid. A small precomputed
   monthly aggregate (commits, lines added and removed, active contributors) per repo
   and module or add-on; zooming below a month loads the per-year commit shards.
   Sub-section selector (repo, add-on, language, path prefix). Overlays: release tags,
   story milestones, Hall of Fame projects, core-team changes. Stories can link to a
   range or module.
2. **Weighted starburst code explorer.** Sunburst with the three repositories as
   first-level nodes, then module or add-on, directory, file and symbol. Weight by
   lines, commits (churn) or recent activity; colour by language or recency. Per-repo
   tree file with lines, commit count and last change per file (rename-following);
   small slices collapse; deeper levels load on click; year slider replays activity.
   Keyboard-navigable tree and table alternative.
3. **Add-on dependency network** and a **core-team swimlane** from the credits history.

Built with D3 modules for scales, zoom, brush and hierarchy, rendered as SVG by React
(canvas past about 5,000 shapes).

## Planned: stories

- Per-project stories for every Student Hall of Fame entry (2012 to 2023), each with
  its arc: first commit, enhancements, moves, current state.
- Feature stories: Spider, Passive Scan, Params, Encoder, Network, Exim, Reports,
  dark mode and themes, Docker images, the Automation Framework, authentication
  (Auth Helper, browser-based and client-script authentication, TOTP, OAuth, assisted auth).
- Open ideas: an optional `zap-hud` source repository so HUD commits can be cited.

## Next

1. Review and commit the drafted stories.
2. M3: annotations, per-type call resolution beyond the same type, `USES_API`.
3. Timeline, then starburst.
4. Per-module shards; accessibility audit; licence.
