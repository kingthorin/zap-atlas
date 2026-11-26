# Stories

Human-authored, evidence-backed narratives. One JSON file per story; the file name (without `.json`) is the story slug and becomes the id `story:atlas:<slug>`.

```json
{
  "title": "…",
  "description": "one or two sentences",
  "group": "projects | features | history",
  "date": "YYYY | YYYY-MM | YYYY-MM-DD",
  "status": "draft | reviewed",
  "narrative": "optional: a short piece of prose, paragraphs separated by a blank line",
  "narrative_sources": [{"label": "…", "url": "https://…"}],
  "chapters": [
    {
      "title": "…",
      "text": "Plain text. State only what the evidence shows.",
      "entities": ["addon:graphql", "module:zaproxy:zap"],
      "commits": ["commit:zaproxy:<full 40-char sha>"],
      "documents": ["doc:<repo>:<path>"],
      "milestones": ["milestone:zaproxy:v2.8.0"],
      "evidence": [{"label": "ZAP ownership page", "url": "https://www.zaproxy.org/docs/zap-ownership/"}]
    }
  ]
}
```

`group` decides which section the card appears in: `projects` (Student Hall of Fame and
other mentored projects), `features` (how a feature or add-on evolved), `history` (the
project, its repositories and its organisation). `date` is when the story starts and
orders the cards inside a group, oldest first: for a student project use the program
term (Summer = June, Spring = March, Autumn = October; a year alone if the term is
unclear), otherwise the date of the earliest event the story cites.

`narrative` is optional, at most 2500 characters (about 400 words), and is the story as a reader meets it:
the story page shows it, headed "The short version", in place of the chapters. The chapters, commits and
evidence stay in the file and are validated as before; a story with no `narrative` shows its chapters.
`narrative_sources` (required with a narrative, at least one entry) lists the posts and pages the text relies on.
The page shows them under the text as "Sources"; each label is a link to an https URL.

### Writing a narrative

Write 150 to 250 words, in three or four short paragraphs, as a person who knows ZAP would tell a colleague.
Open on a situation or a user's problem, not a date. End on where things stand now.

- **Attribution.** The project's own pages and posts were written by the team, so they are not neutral. Say who
  said it: "The maintainers explained", "The project leaders said", "Thanks to". Do not present a post's claim
  as your own fact.
- **Dates from announcements.** Write "An announcement in August 2023 indicates that..." rather than "a post
  announced...". Use months and years, not full dates, except where a date is the point.
- **Facts and context.** Facts (what happened) come only from the story's chapters, evidence and the sources
  you cite. Context (why it mattered: who uses ZAP, what the industry was doing, what a choice probably meant
  for a small team) is allowed, but mark it: "probably", "easy to see why", "for a tool used mostly by...".
  Never invent a quote, a date, a number or what a person thought.
- **No page furniture.** Do not mention banners, labels or notices ("the page carried a banner"). If a reader
  needs that background, put it in a sentence that explains it, or cite it in `narrative_sources`.
- **Connectives.** Use "Related changes followed", not "Practical changes followed at once".
- **Dashes.** No em or en dashes. Use a space, a hyphen and a space: "Simon and Ricardo".
- **Names.** "ZAP" only. "ZAP by Checkmarx" only inside a verbatim quotation. No email addresses.
- **Quotations.** At most two, only where the wording is the point, in straight double quotes.

Rules enforced by `atlas analyze` / `atlas validate`:

- Every entity, commit, document and milestone id must exist in the generated dataset; commits need the full SHA.
- Evidence URLs must be `https`.
- Only `"status": "reviewed"` stories are presented as authoritative; drafts are labelled in the UI.
- Do not invent events, dates, motivations or causes. Say what the commits and pages show, and cite them.
- Use the name "ZAP". Write "ZAP by Checkmarx" only inside a verbatim quotation. The project has not been an OWASP project since August 2023.

Milestones are release tags (`milestone:<repo>:<tag>`, listed on the Releases page); cite one instead of
hand-writing a release date. Weekly tags are not milestones.
