#!/usr/bin/env python3
"""Redacted distribution JSON audit; never display sensitive values in logs."""
import argparse
import gzip
import json
from pathlib import Path
import re
from upload_to_cloudbase import assert_no_leak, normalize_audio_paths, sanitize_lesson_payload

MAX_BYTES = 12 * 1024 * 1024
RISK = (
    re.compile(r"(?i)/(?:users|home)/[^/\s]+/"),
    re.compile(r"(?i)\b[a-z]:[\\/](?:users|documents and settings)[\\/]"),
    re.compile(r"(?:密码\s*[：:]|[（(]\s*密码|(?i:archive[\s_-]+password)\s*[:=])"),
)


class DistributionError(ValueError):
    pass


def iter_text(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from iter_text(k)
            yield from iter_text(v)
    elif isinstance(obj, list):
        for value in obj:
            yield from iter_text(value)


def validate_document(doc):
    try:
        assert_no_leak(doc, "redacted")
    except ValueError:
        raise DistributionError("legacy signature found") from None
    if any(regex.search(s) for s in iter_text(doc) for regex in RISK):
        raise DistributionError("machine path or credential marker")


def read_json(path):
    if path.is_symlink():
        raise DistributionError("symlink")
    opener = gzip.open if path.name.endswith(".json.gz") else open
    with opener(path, "rb") as fp:
        data = fp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise DistributionError("oversized JSON")
    try:
        content = data.decode("utf-8")
        if path.suffix == ".ndjson":
            return [json.loads(line) for line in content.splitlines() if line.strip()]
        return json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise DistributionError("invalid JSON") from None


def scan_distribution(folder):
    folder = Path(folder)
    if not folder.is_dir():
        raise DistributionError("distribution directory missing")
    files = [
        path for path in sorted(folder.rglob("*"))
        if path.is_file() and (path.suffix in (".json", ".ndjson") or path.name.endswith(".json.gz"))
    ]
    if not files:
        raise DistributionError("no JSON artifacts")
    for file in files:
        validate_document(read_json(file))
    return len(files)


def audit_cloudbase_projection(folder, expected_count=335):
    folder = Path(folder)
    index = read_json(folder / "index.json")
    if not isinstance(index, list) or len(index) != expected_count:
        raise DistributionError("unexpected source index size")
    ids = set()
    for item in index:
        if not isinstance(item, dict):
            raise DistributionError("invalid index item")
        lesson_id = item.get("lesson_id") or item.get("LessonId")
        if not isinstance(lesson_id, str) or not re.fullmatch(r"\d{4}", lesson_id):
            raise DistributionError("invalid lesson ID")
        if lesson_id in ids:
            raise DistributionError("duplicate ID")
        ids.add(lesson_id)
        doc = dict(item)
        doc["audio"] = normalize_audio_paths(item.get("audio"), lesson_id)
        validate_document(doc)
        original = read_json(folder / f"lesson_{lesson_id}.json")
        clean = sanitize_lesson_payload(original, lesson_id)
        validate_document(clean)
        if not clean["audio"]["dg"] or not clean["audio"]["pb"]:
            raise DistributionError("missing track")
    return len(ids)


def main():
    parser = argparse.ArgumentParser(description="Fail-closed distribution JSON auditor")
    parser.add_argument("--audit-source", type=Path)
    parser.add_argument("--scan", action="append", type=Path, default=[])
    parser.add_argument("--expected-count", type=int, default=335)
    args = parser.parse_args()
    if not args.audit_source and not args.scan:
        parser.error("provide --audit-source or --scan")
    try:
        if args.audit_source:
            count = audit_cloudbase_projection(args.audit_source, args.expected_count)
            print(f"CloudBase sanitizer projection: {count} lessons verified locally; no upload.")
        for folder in args.scan:
            count = scan_distribution(folder)
            print(f"Distribution JSON audited: {count} artifacts.")
    except (OSError, ValueError, EOFError):
        print("FAIL: invalid or unsafe distribution content; all details redacted.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
