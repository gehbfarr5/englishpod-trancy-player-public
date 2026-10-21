#!/usr/bin/env python3
"""Generate sanitized Flutter assets from the private legacy JSON files.

Keep audio basenames unchanged: the Flutter player derives playback paths from
the basename. Do not synthesize, download or claim to verify actual audio.
"""
import argparse
import json
from pathlib import Path
import re

from check_distribution import validate_document

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "flutter_app/assets/lessons"
OUTPUT = ROOT / "flutter_app/assets/lessons_safe"
SAFE_BASENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:mp3|m4a|aac|wav)$", re.I)
SAFE_ID = re.compile(r"^[0-9]{4}$")


def clean_audio(audio):
    if not isinstance(audio, dict):
        raise ValueError("audio must be an object")
    result = {}
    for track in ("dg", "pb", "rv"):
        value = audio.get(track)
        if value in (None, ""):
            result[track] = None
        elif isinstance(value, str):
            filename = value.replace("\\", "/").rsplit("/", 1)[-1]
            if not SAFE_BASENAME.fullmatch(filename):
                raise ValueError("invalid audio filename")
            result[track] = filename
        else:
            raise ValueError("invalid audio value")
    if not result["dg"] or not result["pb"]:
        raise ValueError("both audio tracks are required")
    return result


def clean_item(item):
    if not isinstance(item, dict):
        raise ValueError("item is not an object")
    result = dict(item)
    result["audio"] = clean_audio(item.get("audio"))
    # Fail closed even when someone runs only this generator before flutter build.
    validate_document(result)
    return result


def prepare(source=SOURCE, output=OUTPUT, expected_count=335):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or source in output.parents or output in source.parents:
        raise ValueError("source and destination must be separate")
    index = json.loads((source / "index.json").read_text(encoding="utf-8"))
    if not isinstance(index, list) or len(index) != expected_count:
        raise ValueError("unexpected index count")
    ids = [row.get("lesson_id") for row in index if isinstance(row, dict)]
    if len(ids) != expected_count or len(set(ids)) != expected_count:
        raise ValueError("duplicate or malformed lesson IDs")
    if any(not isinstance(i, str) or not SAFE_ID.fullmatch(i) for i in ids):
        raise ValueError("invalid lesson ID")

    cleaned_index = [clean_item(row) for row in index]
    cleaned_lessons = {}
    for lesson_id in ids:
        doc = json.loads((source / f"lesson_{lesson_id}.json").read_text(encoding="utf-8"))
        if not isinstance(doc, dict) or doc.get("LessonId") != lesson_id:
            raise ValueError("lesson detail ID mismatch")
        cleaned_lessons[lesson_id] = clean_item(doc)

    # All inputs were checked before modifying generated files.
    output.mkdir(parents=True, exist_ok=True)
    for old in output.glob("*.json"):
        if old.is_symlink():
            raise ValueError("symlink in output directory")
        old.unlink()
    (output / "index.json").write_text(
        json.dumps(cleaned_index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    for lesson_id, doc in cleaned_lessons.items():
        (output / f"lesson_{lesson_id}.json").write_text(
            json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    return len(ids)


def main():
    parser = argparse.ArgumentParser(description="Prepare safe Flutter lesson JSON")
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--expected-count", type=int, default=335)
    args = parser.parse_args()
    try:
        count = prepare(args.source, args.output, args.expected_count)
    except (OSError, ValueError):
        print("FAIL: Flutter asset preparation; source and path details redacted.")
        return 1
    print(f"Prepared {count} sanitized lessons and one index. No real audio was verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
