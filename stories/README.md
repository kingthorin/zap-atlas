# Stories

Human-authored, evidence-backed narratives. One JSON file per story; the file name (without `.json`) is the story slug and becomes the id `story:atlas:<slug>`.

```json
{
  "title": "…",
  "description": "one or two sentences",
  "audience": "developers | community",
  "status": "draft | reviewed",
  "chapters": [
    {
      "title": "…",
      "text": "Plain text. State only what the evidence shows.",
      "entities": ["addon:graphql", "module:zaproxy:zap"],
      "commits": ["commit:zaproxy:<full 40-char sha>"],
      "documents": ["doc:<repo>:<path>"],
      "evidence": [{"label": "ZAP ownership page", "url": "https://www.zaproxy.org/docs/zap-ownership/"}]
    }
  ]
}
```

Rules enforced by `atlas analyze` / `atlas validate`:

- Every entity, commit and document id must exist in the generated dataset; commits need the full SHA.
- Evidence URLs must be `https`.
- Only `"status": "reviewed"` stories are presented as authoritative; drafts are labelled in the UI.
- Do not invent events, dates, motivations or causes. Say what the commits and pages show, and cite them.
- Use the name "ZAP" (or "ZAP by Checkmarx"). The project has not been an OWASP project since August 2023.
