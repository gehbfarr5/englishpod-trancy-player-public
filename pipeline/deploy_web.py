#!/usr/bin/env python3
"""Install verified bundles and atomically switch a scoped static-site pointer."""
import argparse
import json
import os
from pathlib import Path
import shutil
import urllib.request

from web_bundle import verify

HOST_ROOT = Path('/opt/englishpod-runner/web-host')

# Single published entry. There is one site directory and one HTTP port; no
# staging/production split and no second listener. The only container that
# publishes the site binds host 8888 to /srv/site.
SITE_ROOT = HOST_ROOT / 'site'
SITE_URL = 'http://127.0.0.1:8888'


def pointer(root, name, target):
    root = Path(root).resolve()
    target = Path(target).resolve()
    link = root / name
    temporary = root / (name + '.next')
    if temporary.exists() or temporary.is_symlink():
        temporary.unlink()
    # Relative links remain valid when the environment directory is bind-mounted
    # into Nginx at /srv/site rather than at the host's absolute path.
    temporary.symlink_to(os.path.relpath(target, root), target_is_directory=True)
    os.replace(temporary, link)


def current_target(root, name='current'):
    link = root / name
    if not link.is_symlink():
        if link.exists():
            raise ValueError('site pointer must be a symlink')
        return None
    target = link.resolve(strict=True)
    if target.parent != (root / 'releases').resolve():
        raise ValueError('site pointer escaped releases')
    return target


def health(url, sha, run_id):
    # Fixed loopback origins only; no credentials, redirects or remote callbacks.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for path in ('/', '/build-info.json'):
        with opener.open(url + path, timeout=15) as response:
            data = response.read(1024 * 1024)
            if response.status != 200:
                raise ValueError('Web health failed')
            if path.endswith('.json'):
                info = json.loads(data)
                if info['source_sha'] != sha or str(info['run_id']) != str(run_id):
                    raise ValueError('served build differs from activated bundle')


def activate(root, source, sha, run_id, probe):
    root, source = Path(root), Path(source)
    verify(source, sha, run_id)
    root.mkdir(parents=True, exist_ok=True, mode=0o755)
    releases = root / 'releases'
    releases.mkdir(exist_ok=True, mode=0o755)
    previous = current_target(root)
    target = releases / f'{sha}-{run_id}'
    if target.exists():
        verify(target, sha, run_id)
    else:
        staging = releases / f'.incoming-{sha}-{run_id}'
        # Never reuse partial uploads or delete an existing release automatically.
        shutil.copytree(source, staging)
        verify(staging, sha, run_id)
        for path in staging.rglob('*'):
            path.chmod(0o755 if path.is_dir() else 0o644)
        staging.chmod(0o755)
        os.replace(staging, target)
    pointer(root, 'current', target)
    try:
        probe(sha, run_id)
    except Exception:
        if previous is not None:
            pointer(root, 'current', previous)
        else:
            (root / 'current').unlink()
        raise
    if previous is not None and previous != target:
        pointer(root, 'previous', previous)
    return target


def rollback(root, probe):
    root = Path(root)
    target = current_target(root, 'previous')
    if target is None:
        raise ValueError('no previous Web release')
    info = json.loads((target / 'build-info.json').read_text())
    verify(target, info['source_sha'], info['run_id'])
    return activate(root, target, info['source_sha'], info['run_id'], probe)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--bundle', type=Path)
    p.add_argument('--sha')
    p.add_argument('--run-id')
    p.add_argument('--rollback', action='store_true')
    args = p.parse_args()
    root = SITE_ROOT
    probe = lambda sha, run: health(SITE_URL, sha, run)
    if args.rollback:
        rollback(root, probe)
    else:
        if args.bundle is None or args.sha is None or args.run_id is None:
            p.error('bundle, sha and run-id required')
        activate(root, args.bundle, args.sha, args.run_id, probe)
    print(f'PASS: Web pointer and HTTP build identity verified at {SITE_URL}')


if __name__ == '__main__':
    main()
