"""JavaHelp documentation parsing.

Extracts help topics, headings, anchors, links, and image references from
HTML help files. Connects docs to code only when there is explicit evidence
(hrefs), never by name similarity alone.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from html.parser import HTMLParser


@dataclass
class HelpTopic:
    path: str
    title: str = ""
    headings: list[str] = field(default_factory=list)
    anchors: list[str] = field(default_factory=list)
    links: list[str] = field(default_factory=list)  # raw hrefs
    images: list[str] = field(default_factory=list)


class _HelpHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.topic = HelpTopic(path="")
        self._in_heading = False

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._in_heading = True
        if tag == "a" and attr.get("href"):
            self.topic.links.append(attr["href"])
        if tag == "a" and attr.get("name"):
            self.topic.anchors.append(attr["name"])
        if attr.get("id"):
            self.topic.anchors.append(attr["id"])
        if tag == "img" and attr.get("src"):
            self.topic.images.append(attr["src"])

    def handle_data(self, data):
        if self._in_heading:
            text = data.strip()
            if text:
                self.topic.headings.append(text)
            self._in_heading = False

    def handle_endtag(self, tag):
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._in_heading = False


def parse_help_file(path: Path, rel_to: Path | None = None) -> HelpTopic | None:
    if not path.is_file():
        return None
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return None
    parser = _HelpHTMLParser()
    parser.topic.path = (path.relative_to(rel_to) if rel_to else path).as_posix()
    parser.feed(text)
    # title from first h1 or filename
    parser.topic.title = parser.topic.headings[0] if parser.topic.headings else path.stem
    return parser.topic


_LOCALE_DIR = re.compile(r"^help_[a-z]{2,3}_[A-Z]{2}$")


def discover_help_topics(javahelp_dir: Path, rel_to: Path | None = None) -> list[HelpTopic]:
    """English help topics only: locale directories (help_xx_YY) are skipped."""
    topics = []
    if not javahelp_dir.is_dir():
        return topics
    for html in javahelp_dir.rglob("*.html"):
        if any(_LOCALE_DIR.match(part) for part in html.relative_to(javahelp_dir).parts):
            continue
        t = parse_help_file(html, rel_to)
        if t:
            topics.append(t)
    return topics

