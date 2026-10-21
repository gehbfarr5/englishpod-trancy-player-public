#!/usr/bin/env python3
"""Pack and safely unpack private Web Release assets, independent of Actions storage."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import zipfile

from web_bundle import verify


def pack(directory, output, sha, run_id, metadata):
    directory, output = Path(directory), Path(output)
    info = verify(directory, sha, run_id)
    if output.exists():
        raise ValueError('archive already exists')
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(directory.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(directory).as_posix())
    info = {**info, 'archive_sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
    Path(metadata).write_text(json.dumps(info, indent=2) + '\n')
    return info


def unpack(archive_path, output, sha, run_id, digest):
    archive_path, output = Path(archive_path), Path(output)
    if output.exists() or output.is_symlink():
        raise ValueError('extraction destination already exists')
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != digest:
        raise ValueError('release archive digest mismatch')
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(x.file_size for x in entries) > 512 * 1024 * 1024:
            raise ValueError('oversized Web archive')
        names = set()
        for entry in entries:
            name = PurePosixPath(entry.filename)
            if (name.is_absolute() or '..' in name.parts or '\\' in entry.filename
                    or ':' in entry.filename or entry.filename in names
                    or stat.S_ISLNK(entry.external_attr >> 16)):
                raise ValueError('unsafe Web archive path')
            names.add(entry.filename)
        output.mkdir(parents=True)
        archive.extractall(output)
    return verify(output, sha, run_id)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['pack', 'unpack'])
    p.add_argument('--directory', type=Path)
    p.add_argument('--archive', type=Path)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--sha', required=True)
    p.add_argument('--run-id', required=True)
    p.add_argument('--metadata', type=Path)
    p.add_argument('--digest')
    args = p.parse_args()
    if args.command == 'pack':
        if args.directory is None or args.metadata is None:
            p.error('directory and metadata required')
        pack(args.directory, args.output, args.sha, args.run_id, args.metadata)
    else:
        if args.archive is None or args.digest is None:
            p.error('archive and digest required')
        unpack(args.archive, args.output, args.sha, args.run_id, args.digest)
    print('PASS: Web release archive and source identity')


if __name__ == '__main__':
    main()
