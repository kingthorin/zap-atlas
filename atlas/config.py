"""Configuration for the ZAP Atlas generator."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class SourceRepo:
    """A single upstream source repository to analyze."""

    name: str  # short identity, e.g. "zaproxy"
    url: str   # git URL
    default_branch: str | None = None  # discovered dynamically; None = discover
    branch: str | None = None  # optional override
    sha: str | None = None  # optional exact SHA override
    include: bool = True


@dataclass
class AtlasConfig:
    """Top-level generator configuration."""

    # Source repositories (discovered/default branches resolved at runtime).
    sources: list[SourceRepo] = field(
        default_factory=lambda: [
            SourceRepo(
                name="zaproxy",
                url="https://github.com/zaproxy/zaproxy.git",
            ),
            SourceRepo(
                name="zap-extensions",
                url="https://github.com/zaproxy/zap-extensions.git",
            ),
            SourceRepo(
                name="zap-core-help",
                url="https://github.com/zaproxy/zap-core-help.git",
            ),
        ]
    )

    # Working directories.
    sources_dir: Path = Path("sources")
    output_dir: Path = Path("data")

    # Vertical-slice MVP focus (subset for the first real-data slice).
    # None = process everything once scaled.

    focus_modules: list[str] | None = None

    # Schema / generator versions embedded in the manifest.

    schema_version: str = "1.0"

    generator_version: str = __import__("atlas", fromlist=["__version__"]).__version__

    # Git history depth. None = full history (mandatory for MVP).

    history_depth: int | None = None



DEFAULT_CONFIG = AtlasConfig()


