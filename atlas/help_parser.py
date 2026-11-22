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
            if attr.get("name"):
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


def parse_help_file(path: Path) -> HelpTopic | None:
    if not path.is_file():
        return None
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return None
    parser = _HelpHTMLParser()
    parser.topic.path = str(path)
    parser.feed(text)
    # title from first h1 or filename
    if parser.topic.headings:
        parser.topic.title = parser.topic.headings[0]
    return parser.topic


def discover_help_topics(javahelp_dir: Path) -> list[HelpTopic]:
    topics = []
    if not javahelp_dir.is_dir():
        return topics
    for html in javahelp_dir.rglob("*.html"):
        t = parse_help_file(html)
        if t:
            topics.append(t)
    return topics

