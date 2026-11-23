"""JSON for the whole-document data files: two-space indent, with arrays of plain values kept on one line."""
from __future__ import annotations

import json
import re

_FLAT = re.compile(r"\[\s*([^\[\]{}]*?)\s*\]")


def dumps(value, **kw) -> str:
    return _FLAT.sub(lambda m: "[" + re.sub(r"\s*\n\s*", " ", m.group(1)) + "]", json.dumps(value, indent=2, **kw))
