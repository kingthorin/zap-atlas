# Stories

Human-authored, evidence-backed narratives. One JSON file per story; the file name (without `.json`) is the story slug and becomes the id `story:atlas:<slug>`.

```json
{
  "title": "…",
  "description": "one or two sentences",
  "audience": "developers | community",
  "group": "projects | features | history",
  "date": "YYYY | YYYY-MM | YYYY-MM-DD",
  "status": "draft | reviewed",
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

Rules enforced by `atlas analyze` / `atlas validate`:

- Every entity, commit, document and milestone id must exist in the generated dataset; commits need the full SHA.
- Evidence URLs must be `https`.
- Only `"status": "reviewed"` stories are presented as authoritative; drafts are labelled in the UI.
- Do not invent events, dates, motivations or causes. Say what the commits and pages show, and cite them.
- Use the name "ZAP" (or "ZAP by Checkmarx"). The project has not been an OWASP project since August 2023.

Milestones are release tags (`milestone:<repo>:<tag>`, listed on the Releases page); cite one instead of
hand-writing a release date. Weekly tags are not milestones.
