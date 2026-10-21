#!/usr/bin/env python3
"""Check or bump EnglishPod source versions; never deploy or publish."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def parse_semver(value):
    match = SEMVER.fullmatch(value)
    if not match:
        raise ValueError("invalid semantic version")
    return tuple(int(x) for x in match.groups())


def load_manifest(root=ROOT):
    data = json.loads((root / "release/versions.json").read_text(encoding="utf-8"))
    if data.get("schema_version") != 1:
        raise ValueError("unsupported version manifest schema")
    mobile = data["mobile"]
    parse_semver(mobile["version"])
    if type(mobile["build"]) is not int or mobile["build"] < 1:
        raise ValueError("mobile build number must be a positive integer")
    mini = data["miniprogram"]
    source_version = parse_semver(mini["version"])
    # Owner-verified platform high-water mark, not a live WeChat API query.
    # This catches a synchronized downgrade that package/lock equality misses.
    platform_floor = parse_semver(mini["highest_observed_platform_version"])
    if source_version < platform_floor:
        raise ValueError("Mini Program source version is below the observed platform version")
    if data.get("web_preview") != {"distribution": "prototype", "version": None}:
        raise ValueError("web preview must remain explicitly unversioned")
    return data


def check(root=ROOT):
    data = load_manifest(root)
    flutter = (root / "flutter_app/pubspec.yaml").read_text(encoding="utf-8")
    expected = f'version: {data["mobile"]["version"]}+{data["mobile"]["build"]}'
    matches = re.findall(r"(?m)^version: .+$", flutter)
    if matches != [expected]:
        raise ValueError("Flutter pubspec version mismatches release/versions.json")
    pkg = json.loads((root / "miniprogram/package.json").read_text(encoding="utf-8"))
    lock = json.loads((root / "miniprogram/package-lock.json").read_text(encoding="utf-8"))
    mv = data["miniprogram"]["version"]
    if pkg["version"] != mv or lock["version"] != mv or lock["packages"][""]["version"] != mv:
        raise ValueError("Mini Program package/lock source versions mismatch release/versions.json")
    if lock.get("name") != pkg.get("name") or lock["packages"][""].get("name") != pkg.get("name"):
        raise ValueError("Mini Program lockfile package identity mismatch")
    return data


def next_semver(version, part):
    major, minor, patch = parse_semver(version)
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError("unsupported semver part")


def bump(root, platform, part):
    # Refuse to edit a baseline which is already internally inconsistent.
    data = check(root)
    updates = {}
    if platform == "mobile":
        mobile = data["mobile"]
        if part != "build":
            mobile["version"] = next_semver(mobile["version"], part)
        mobile["build"] += 1
        path = root / "flutter_app/pubspec.yaml"
        source = path.read_text(encoding="utf-8")
        source, count = re.subn(r"(?m)^version: .+$",
            f'version: {mobile["version"]}+{mobile["build"]}', source)
        if count != 1:
            raise ValueError("missing Flutter version")
        updates[path] = source
    elif platform == "miniprogram":
        if part == "build":
            raise ValueError("Mini Program uses semantic source versions, not mobile build codes")
        prior = data["miniprogram"]["version"]
        updated = next_semver(prior, part)
        data["miniprogram"]["version"] = updated
        for filename, indentation in (("miniprogram/package.json", 2),
                                      ("miniprogram/package-lock.json", 2)):
            path = root / filename
            source = path.read_text(encoding="utf-8")
            prefix = " " * indentation
            oldline = f'{prefix}"version": "{prior}",'
            newline = f'{prefix}"version": "{updated}",'
            # Anchor at line start: the lockfile also has a 6-space nested
            # version field, which must not count as the 2-space root field.
            source, count = re.subn(
                r"(?m)^" + re.escape(oldline) + r"$",
                lambda _match: newline, source)
            if count != 1:
                raise ValueError("unexpected Mini Program root version structure")
            if filename.endswith("package-lock.json"):
                # Anchor the nested rewrite to the ROOT package entry, not
                # just any 6-space version line: dependencies can share the
                # same version string (e.g. @babel packages at 0.3.3), so a
                # bare indent-anchored match is ambiguous. The root entry is
                # uniquely identified by its name line (check() already
                # asserts it equals package.json's name).
                lock_payload = json.loads(source)
                lock_name = lock_payload.get("name")
                if not isinstance(lock_name, str) or not lock_name:
                    raise ValueError("missing lockfile package name for anchoring")
                # Root entry layout (lockfileVersion 3, 2-space JSON indent):
                #     "name": "<lock_name>",      <- 6 spaces
                #     "version": "<prior>",       <- 6 spaces, rewrite this
                root_entry = re.compile(
                    '(?m)^(      "name": ' + re.escape(json.dumps(lock_name)) + ',\n'
                    '      "version": ")' + re.escape(prior) + '(",)$'
                )
                source, nested_count = root_entry.subn(
                    lambda m: m.group(1) + updated + m.group(2), source)
                if nested_count != 1:
                    raise ValueError("missing lockfile root package version")
            updates[path] = source
    else:
        raise ValueError("only mobile and miniprogram have source versions")
    updates[root / "release/versions.json"] = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    for path, content in updates.items():
        path.write_text(content, encoding="utf-8")
    check(root)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    run = sub.add_parser("bump")
    run.add_argument("--platform", choices=["mobile", "miniprogram"], required=True)
    run.add_argument("--part", choices=["build", "patch", "minor", "major"], required=True)
    args = parser.parse_args()
    try:
        data = check() if args.command == "check" else bump(ROOT, args.platform, args.part)
    except (KeyError, TypeError, OSError, ValueError, json.JSONDecodeError) as exc:
        parser.exit(1, "Version validation failed: " + str(exc) + "\n")
    print("PASS: source version manifest consistent: mobile "
          f'{data["mobile"]["version"]}+{data["mobile"]["build"]}, '
          f'miniprogram {data["miniprogram"]["version"]}; Web prototype is unversioned.')


if __name__ == "__main__":
    main()
