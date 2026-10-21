#!/usr/bin/env python3
"""Stage Flutter Web without shipping mobile audio or legacy lesson JSON."""
import argparse
import json
from pathlib import Path
import re
import shutil

from prepare_flutter_lessons import prepare


def stage(root, output, expected_count=335):
    root, output = Path(root).resolve(), Path(output).resolve()
    if root == output or root in output.parents or output in root.parents:
        raise ValueError('Web staging must be outside the repository')
    if output.exists():
        raise ValueError('Web staging destination must not already exist')
    version = json.loads((root / 'release/web.json').read_text())
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version['version']):
        raise ValueError('invalid Web version')
    if type(version['build']) is not int or version['build'] < 1:
        raise ValueError('invalid Web build')
    app = root / 'flutter_app'
    output.mkdir(parents=True)
    for folder in ('lib', 'test', 'web', 'assets/branding'):
        source = app / folder
        if source.exists():
            if any(path.is_symlink() for path in source.rglob('*')):
                raise ValueError('symlink in Web source')
            shutil.copytree(source, output / folder)
    for name in ('pubspec.lock', 'analysis_options.yaml'):
        if (app / name).is_file():
            shutil.copyfile(app / name, output / name)
    pubspec = (app / 'pubspec.yaml').read_text()
    pubspec = re.sub(r'(?m)^version: .+$',
                     f'version: {version["version"]}+{version["build"]}', pubspec)
    pubspec = re.sub(r'(?m)^\s+- assets/audio/[^\n]*\n?', '', pubspec)
    if 'assets/lessons_safe/' not in pubspec or 'assets/lessons/' in pubspec:
        raise ValueError('unsafe Web asset manifest')
    (output / 'pubspec.yaml').write_text(pubspec)
    prepare(app / 'assets/lessons', output / 'assets/lessons_safe', expected_count)
    return version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    version = stage(args.root, args.output)
    print(f'Web candidate {version["version"]}+{version["build"]} staged; audio is streamed separately.')


if __name__ == '__main__':
    main()
