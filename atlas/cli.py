"""Command-line interface for the ZAP Atlas generator.

Usage:
    atlas analyze --sources ./sources --output ./build/atlas
    atlas validate ./build/atlas
    atlas inspect --entity addon:ascanrules
    atlas history --repository zap-extensions
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from atlas.config import DEFAULT_CONFIG, AtlasConfig, SourceRepo
from atlas.sources import checkout_sources
from atlas.java_parser import JavaParser
from atlas.manifest import AtlasGenerator
from atlas.validate import validate_dataset

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="atlas", description="ZAP Atlas generator")
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Run analysis and generation")
    p_analyze.add_argument("--sources", type=Path, default=DEFAULT_CONFIG.sources_dir)
    p_analyze.add_argument("--output", type=Path, default=DEFAULT_CONFIG.output_dir)
    p_analyze.add_argument("--focus", action="append", default=None,
                           help="Restrict to a module/addon (repeatable)")

    p_index = sub.add_parser("index", help="(Re)build the static search index for a generated dataset")
    p_index.add_argument("dataset", type=Path)

    p_reshard = sub.add_parser("reshard", help="Rewrite symbols and relationships of a dataset into per-module shards")
    p_reshard.add_argument("dataset", type=Path)

    p_timeline = sub.add_parser("timeline", help="Rebuild timeline.json from the commit shards of a dataset")
    p_timeline.add_argument("dataset", type=Path)

    p_validate = sub.add_parser("validate", help="Validate generated data")
    p_validate.add_argument("dataset", type=Path)
    p_validate.add_argument("--contract", action="store_true",
                            help="also check the files the frontend fetches exist (run after analyze)")

    p_report = sub.add_parser("report", help="Print a Markdown report of a generated dataset")
    p_report.add_argument("dataset", type=Path)

    p_inspect = sub.add_parser("inspect", help="Inspect a single entity")
    p_inspect.add_argument("--entity", required=True, help="Entity ID, e.g. addon:ascanrules")

    p_history = sub.add_parser("history", help="Show repository history summary")
    p_history.add_argument("--repository", required=True)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "analyze":
        return cmd_analyze(args)
    if args.command == "index":
        from atlas.search_index import build_search_index
        print(f"[atlas] index {args.dataset}: {build_search_index(args.dataset)}")
        return 0
    if args.command == "reshard":
        from atlas.sharding import reshard
        print(f"[atlas] wrote {len(reshard(args.dataset))} shard files")
        return 0
    if args.command == "timeline":
        from atlas.timeline import rebuild_from_shards
        print(f"[atlas] wrote {rebuild_from_shards(args.dataset)}")
        return 0
    if args.command == "report":
        from atlas.report import build_report
        print(build_report(args.dataset))
        return 0
    if args.command == "validate":
        return cmd_validate(args)
    if args.command == "inspect":
        return cmd_inspect(args)
    if args.command == "history":
        return cmd_history(args)
    parser.error("unknown command")
    return 2


def cmd_analyze(args) -> int:
    config = DEFAULT_CONFIG
    if args.focus:
        config.focus_modules = args.focus
    print(f"[atlas] analyze -> sources {args.sources} output {args.output}")
    from atlas.manifest import AtlasGenerator
    gen = AtlasGenerator(config)
    gen.run(args.sources, args.output)
    from atlas.search_index import build_search_index
    build_search_index(args.output)
    print("[atlas] analyze complete")
    return 0


def cmd_validate(args) -> int:
    print(f"[atlas] validate {args.dataset}")
    ok = validate_dataset(args.dataset)
    if args.contract:
        from atlas.validate import check_contract
        problems = check_contract(args.dataset)
        for p in problems[:50]:
            print(f"[validate] contract: {p}")
        ok = ok and not problems
    return 0 if ok else 1


def cmd_inspect(args) -> int:
    print(f"[atlas] inspect {args.entity} (not yet implemented)")
    return 0


def cmd_history(args) -> int:
    print(f"[atlas] history {args.repository} (not yet implemented)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

