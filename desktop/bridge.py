"""Read the current sau argparse contract for the desktop form builder."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from sau_cli import build_parser


FILE_FIELDS = {
    "file", "thumbnail", "thumbnail_landscape", "thumbnail_portrait",
    "content_file", "notef", "result", "output",
}


def choices_for(parser: argparse.ArgumentParser) -> list[dict]:
    subparsers = next(
        (item for item in parser._actions if isinstance(item, argparse._SubParsersAction)),
        None,
    )
    if subparsers is None:
        return []
    descriptions = {item.dest: item.help for item in subparsers._choices_actions}
    return [
        {
            "name": name,
            "description": descriptions.get(name) or "",
            "actions": choices_for(child),
            "options": options_for(child),
        }
        for name, child in subparsers.choices.items()
    ]


def options_for(parser: argparse.ArgumentParser) -> list[dict]:
    options = []
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction) or action.dest == "help":
            continue
        if isinstance(action, (argparse._StoreTrueAction, argparse._StoreFalseAction)):
            kind = "boolean"
        elif action.dest == "images" or action.nargs in ("+", "*"):
            kind = "files" if action.dest == "images" else "text"
        elif action.dest in FILE_FIELDS:
            kind = "file"
        elif action.dest == "schedule":
            kind = "schedule"
        elif action.type is int:
            kind = "number"
        elif action.choices:
            kind = "choice"
        else:
            kind = "text"
        options.append({
            "name": action.dest,
            "flags": action.option_strings,
            "kind": kind,
            "required": action.required or not action.option_strings,
            "help": action.help or "",
            "choices": [str(choice) for choice in action.choices] if action.choices else [],
            "multiple": action.nargs in ("+", "*"),
        })
    return options


if __name__ == "__main__":
    print(json.dumps(choices_for(build_parser()), ensure_ascii=False))
