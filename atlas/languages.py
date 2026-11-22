"""Per-repo, per-module file and line counts by language (tracked files at HEAD).

Help content is mostly HTML, so it is counted like code rather than ignored.
Binary files count as files with zero lines.
"""

from __future__ import annotations

import subprocess
from collections import defaultdict
from pathlib import Path

LANGUAGES = {
    ".java": "Java", ".kt": "Kotlin", ".kts": "Gradle", ".gradle": "Gradle",
    ".html": "HTML", ".htm": "HTML", ".css": "CSS", ".js": "JavaScript", ".ts": "TypeScript",
    ".py": "Python", ".zst": "Zest", ".xml": "XML", ".hs": "XML", ".jhm": "XML",
    ".properties": "Properties", ".json": "JSON", ".yml": "YAML", ".yaml": "YAML",
    ".md": "Markdown", ".txt": "Text", ".sh": "Shell", ".bat": "Shell",
    ".png": "Image", ".jpg": "Image", ".jpeg": "Image", ".gif": "Image", ".svg": "Image", ".ico": "Image",
}


def _language(path: str) -> str:
    return LANGUAGES.get(Path(path).suffix.lower(), "Other")


def count_languages(repo_name: str, repo_path: Path, module_paths: list[str]) -> list[dict]:
    files = subprocess.run(["git", "-C", str(repo_path), "ls-files", "-z"],
                           capture_output=True, check=True).stdout.decode("utf8", "replace").split("\0")
    mods = sorted((m for m in module_paths), key=len, reverse=True)
    totals: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    for rel in filter(None, files):
        module = next((m for m in mods if rel.startswith(m + "/")), "")
        lang = _language(rel)
        try:
            data = (repo_path / rel).read_bytes()
        except OSError:
            continue
        lines = 0
        if lang != "Image" and b"\0" not in data[:8000]:
            lines = data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0)
        t = totals[(module, lang)]
        t[0] += 1
        t[1] += lines
    return [{"id": f"lang:{repo_name}:{module or '-'}:{lang}", "repository": repo_name, "module": module,
             "language": lang, "files": f, "lines": n} for (module, lang), (f, n) in sorted(totals.items())]
