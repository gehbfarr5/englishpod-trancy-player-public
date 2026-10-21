#!/usr/bin/env python3
"""Seal/verify an immutable Web bundle with source and workflow provenance."""
import argparse
import hashlib
import json
from pathlib import Path
import re

SHA = re.compile(r'[0-9a-f]{40}')


def inventory(folder):
    folder = Path(folder)
    entries = {}
    for path in sorted(folder.rglob('*')):
        if path.is_symlink():
            raise ValueError('bundle symlink rejected')
        if path.is_file():
            relative = path.relative_to(folder).as_posix()
            if relative == 'bundle-manifest.json':
                continue
            if path.suffix in ('.mp3', '.m4a', '.map') or path.name.startswith('.'):
                raise ValueError('unexpected private/debug/media artifact')
            entries[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    return entries


def verify(folder, sha, run_id):
    folder = Path(folder)
    if not SHA.fullmatch(sha) or not str(run_id).isdigit():
        raise ValueError('invalid build identity')
    info = json.loads((folder / 'build-info.json').read_text())
    if info['source_sha'] != sha or str(info['run_id']) != str(run_id):
        raise ValueError('bundle provenance mismatch')
    manifest = json.loads((folder / 'bundle-manifest.json').read_text())
    if manifest != inventory(folder):
        raise ValueError('bundle content mismatch')
    for name in ('index.html', 'flutter_bootstrap.js', 'main.dart.js',
                 'assets/assets/lessons_safe/index.json'):
        if name not in manifest:
            raise ValueError('incomplete Web bundle')
    return info


def seal(folder, version_file, sha, run_id):
    folder = Path(folder)
    if not SHA.fullmatch(sha) or not str(run_id).isdigit():
        raise ValueError('invalid build identity')
    # Flutter emits build bookkeeping and renderer source maps. They are not
    # runtime resources and must not be part of the distributable frontend.
    for path in [folder / '.last_build_id', *folder.rglob('*.map')]:
        if path.is_symlink():
            raise ValueError('bundle symlink rejected')
        if path.is_file():
            path.unlink()
    version = json.loads(Path(version_file).read_text())
    info = {**version, 'source_sha': sha, 'run_id': str(run_id),
            'audio_delivery': 'separate-same-origin-stream'}
    (folder / 'build-info.json').write_text(json.dumps(info, indent=2) + '\n')
    (folder / 'bundle-manifest.json').write_text(json.dumps(inventory(folder), indent=2) + '\n')
    return verify(folder, sha, run_id)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['seal', 'verify'])
    p.add_argument('--directory', type=Path, required=True)
    p.add_argument('--sha', required=True)
    p.add_argument('--run-id', required=True)
    p.add_argument('--version-file', type=Path, default=Path('release/web.json'))
    args = p.parse_args()
    if args.command == 'seal':
        seal(args.directory, args.version_file, args.sha, args.run_id)
    else:
        verify(args.directory, args.sha, args.run_id)
    print('PASS: Web bundle content and provenance')


if __name__ == '__main__':
    main()
