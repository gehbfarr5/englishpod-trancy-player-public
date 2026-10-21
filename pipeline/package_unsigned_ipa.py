#!/usr/bin/env python3
"""Package unsigned Flutter Runner.app as Payload/Runner.app in IPA for local signing."""
import argparse
import os
import plistlib
import stat
import sys
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo
from validate_ios_profile import BUNDLE_ID

APP_PREFIX = "Payload/Runner.app"

def validate_app(app):
    if app.name != "Runner.app" or not app.is_dir() or app.is_symlink():
        raise ValueError("expected real Runner.app")
    info = plistlib.loads((app / "Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != BUNDLE_ID:
        raise ValueError("wrong compiled Bundle ID")
    exe = info.get("CFBundleExecutable")
    if not isinstance(exe, str) or not exe or not (app / exe).is_file():
        raise ValueError("app executable missing")
    if (app / "_CodeSignature").exists() or (app / "embedded.mobileprovision").exists():
        raise ValueError("input is already signed")
    return info

def add_tree(archive, root, directory):
    for child in sorted(directory.iterdir()):
        entry = APP_PREFIX + "/" + child.relative_to(root).as_posix()
        if child.is_symlink():
            item = ZipInfo(entry)
            item.create_system = 3
            item.external_attr = (stat.S_IFLNK | 0o777) << 16
            item.compress_type = ZIP_STORED
            archive.writestr(item, os.readlink(child).encode("utf-8"))
        elif child.is_dir():
            archive.write(child, entry + "/", compress_type=ZIP_STORED)
            add_tree(archive, root, child)
        elif child.is_file():
            archive.write(child, entry, compress_type=ZIP_STORED)
        else:
            raise ValueError("unsupported filesystem entry")

def verify_archive(ipa):
    with ZipFile(ipa) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or any(
            not name.startswith("Payload/") or ".." in Path(name).parts for name in names
        ):
            raise ValueError("invalid IPA layout")
        info = plistlib.loads(archive.read(APP_PREFIX + "/Info.plist"))
        if info.get("CFBundleIdentifier") != BUNDLE_ID:
            raise ValueError("IPA Bundle ID mismatch")
        exe = info.get("CFBundleExecutable")
        if not isinstance(exe, str) or not exe or not archive.getinfo(APP_PREFIX + "/" + exe).file_size:
            raise ValueError("IPA executable missing")
        if any(n == APP_PREFIX + "/embedded.mobileprovision"
               or n.startswith(APP_PREFIX + "/_CodeSignature/") for n in names):
            raise ValueError("IPA must be unsigned")
        return BUNDLE_ID

def package(app, output):
    validate_app(app)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError("refusing to overwrite existing IPA")
    temporary = output.with_name(output.name + ".partial")
    if temporary.exists():
        raise ValueError("partial IPA already exists")
    try:
        with ZipFile(temporary, "w", compression=ZIP_STORED, allowZip64=True) as archive:
            archive.writestr("Payload/", b"")
            archive.write(app, APP_PREFIX + "/", compress_type=ZIP_STORED)
            add_tree(archive, app, app)
        result = verify_archive(temporary)
        temporary.rename(output)
        return result
    finally:
        temporary.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        bundle = package(args.app, args.output)
    except (OSError, ValueError, KeyError, plistlib.InvalidFile) as exc:
        print("Unsigned IPA packaging failed: " + type(exc).__name__, file=sys.stderr)
        return 1
    print("Unsigned IPA created, Bundle ID " + bundle + "; NOT INSTALLABLE UNTIL LOCALLY SIGNED")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
