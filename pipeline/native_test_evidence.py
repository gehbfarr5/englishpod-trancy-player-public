#!/usr/bin/env python3
"""Bounded native regression evidence. No model calls, raw logs or device IDs."""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request
import zipfile

SCHEMA = 'ep-native-regression-v1'
IDS = ('N01', 'N02', 'N03')
PLATFORMS = ('android-emulator', 'ios-simulator', 'ios-device')
MAX_JSON = 32 * 1024
MAX_LOG_ZIP = 8 * 1024 * 1024


def validate(report, sha, run_id, platform, attempt=1):
    if not isinstance(report, dict) or set(report) != {'schema', 'sha', 'runId', 'runAttempt', 'platform', 'resourceKind', 'runtime', 'exitCode', 'status', 'scenarios'}:
        raise ValueError('report_shape')
    if report['schema'] != SCHEMA or report['sha'] != sha or report['runId'] != str(run_id) or report['platform'] != platform:
        raise ValueError('provenance')
    if type(report['runAttempt']) is not int or report['runAttempt'] != attempt or attempt < 1:
        raise ValueError('run_attempt')
    if not re.fullmatch(r'[a-f0-9]{40}', sha) or platform not in PLATFORMS or report['resourceKind'] != 'synthetic-wav':
        raise ValueError('source')
    if type(report['exitCode']) is not int or not -255 <= report['exitCode'] <= 255:
        raise ValueError('exit_code')
    runtime = report['runtime']
    if not isinstance(runtime, str) or not re.fullmatch(r'[A-Za-z0-9 ._()+:-]{1,160}', runtime):
        raise ValueError('runtime')
    rows = report['scenarios']
    if not isinstance(rows, list) or len(rows) != len(IDS) or [r.get('id') for r in rows if isinstance(r, dict)] != list(IDS):
        raise ValueError('scenario_inventory')
    for row in rows:
        if set(row) != {'id', 'status', 'elapsedMs'} or row['status'] not in ('PASS', 'FAIL', 'NOT_TESTED'):
            raise ValueError('scenario_shape')
        if type(row['elapsedMs']) is not int or not 0 <= row['elapsedMs'] <= 3600000:
            raise ValueError('scenario_time')
    expected = outcome(rows, report['exitCode'])
    if report['status'] != expected:
        raise ValueError('false_outcome')
    return report


def outcome(rows, exit_code):
    if any(row['status'] == 'FAIL' for row in rows):
        return 'FAIL'
    if exit_code == 0 and all(row['status'] == 'PASS' for row in rows):
        return 'PASS'
    return 'ERROR'


def finalize(response, sha, run_id, platform, runtime, exit_code, attempt=1):
    rows = []
    try:
        raw = Path(response).read_bytes()
        if len(raw) > MAX_JSON:
            raise ValueError('response_size')
        data = json.loads(raw)
        rows = data['scenarios']
        if not isinstance(rows, list) or len(rows) > len(IDS):
            raise ValueError('scenario_inventory')
        if len({r['id'] for r in rows}) != len(rows) or any(r['id'] not in IDS for r in rows):
            raise ValueError('scenario_inventory')
    except (OSError, ValueError, TypeError, KeyError):
        rows = []
    indexed = {r['id']: r for r in rows}
    normalized = [indexed.get(i, {'id': i, 'status': 'NOT_TESTED', 'elapsedMs': 0}) for i in IDS]
    report = dict(schema=SCHEMA, sha=sha, runId=str(run_id), runAttempt=attempt, platform=platform,
                  resourceKind='synthetic-wav', runtime=runtime, exitCode=exit_code,
                  status=outcome(normalized, exit_code), scenarios=normalized)
    return validate(report, sha, run_id, platform, attempt)


def read_archive(payload, sha, run_id, platform, attempt=1):
    if len(payload) > 256 * 1024:
        raise ValueError('archive_size')
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        # Read one fixed file; never extract archive paths or run artifact content.
        entries = z.infolist()
        if len(entries) != 1 or entries[0].filename != 'report.json' or entries[0].file_size > MAX_JSON:
            raise ValueError('archive_layout')
        raw = z.read(entries[0])
        if len(raw) > MAX_JSON:
            raise ValueError('report_size')
        return validate(json.loads(raw), sha, run_id, platform, attempt)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download(url, token, limit, archive=False):
    # Only GitHub API receives the GitHub credential. Signed artifact redirects do not.
    if not url.startswith('https://api.github.com/repos/'):
        raise ValueError('api_url')
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token,
                                               'Accept': 'application/vnd.github+json'})
    try:
        response = urllib.request.build_opener(NoRedirect).open(req, timeout=30)
    except urllib.error.HTTPError as error:
        if not archive or error.code not in (301, 302, 303, 307, 308):
            raise
        redirect = error.headers.get('Location', '')
        if not redirect.startswith('https://'):
            raise ValueError('artifact_redirect')
        response = urllib.request.urlopen(redirect, timeout=30)
    with response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('download_size')
    return data


def collect(repo, sha, token):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo) or not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('request_identity')
    api = f'https://api.github.com/repos/{repo}'
    data = json.loads(download(api + '/actions/workflows/mobile-regression.yml/runs?branch=main&per_page=20', token, 1024 * 1024))
    runs = [r for r in data.get('workflow_runs', []) if r.get('head_sha') == sha and r.get('head_branch') == 'main'
            and r.get('event') in ('push', 'workflow_dispatch') and r.get('status') == 'completed']
    samples, rejected = [], 0
    if runs:
        run = max(runs, key=lambda r: r['id'])
        artifacts = json.loads(download(api + f"/actions/runs/{run['id']}/artifacts?per_page=30", token, 128 * 1024))
        jobs = json.loads(download(api + f"/actions/runs/{run['id']}/jobs?per_page=100", token, 512 * 1024))
        for platform in PLATFORMS:
            attempt = run.get('run_attempt', 1)
            name = f'native-report-{platform}-attempt-{attempt}'
            candidates = [a for a in artifacts.get('artifacts', []) if a.get('name') == name and not a.get('expired')]
            if len(candidates) != 1:
                # Actions artifact storage can be exhausted. Recover only the
                # trusted finalizer's one-line, schema-validated JSON marker.
                matching = [j for j in jobs.get('jobs', []) if j.get('name') in (f'Native / {platform}', f'Device / {platform}')]
                if not matching and not candidates:
                    continue
                if len(matching) != 1:
                    rejected += 1
                    continue
                try:
                    zipped_logs = download(api + f"/actions/jobs/{int(matching[0]['id'])}/logs", token,
                                           MAX_LOG_ZIP, archive=True)
                    report = read_log_report(zipped_logs, sha, run['id'], platform, attempt)
                    samples.append({'workflowConclusion': run.get('conclusion'), 'report': report})
                except (OSError, ValueError, KeyError, zipfile.BadZipFile):
                    rejected += 1
                continue
            try:
                payload = download(api + f"/actions/artifacts/{int(candidates[0]['id'])}/zip", token, 256 * 1024, archive=True)
                report = read_archive(payload, sha, run['id'], platform, attempt)
                samples.append({'workflowConclusion': run.get('conclusion'), 'report': report})
            except (OSError, ValueError, KeyError, zipfile.BadZipFile):
                rejected += 1
    return {'schema': 'ep-native-scout-input-v1', 'sourceSha': sha, 'sampleCount': len(samples),
            'rejectedCount': rejected, 'samples': samples,
            'coverage': 'synthetic audio on emulator/simulator; no physical-device or audible-output proof'}


def read_log_report(payload, sha, run_id, platform, attempt=1):
    if len(payload) > MAX_LOG_ZIP:
        raise ValueError('log_archive_size')
    marker = re.compile(rb'^(?:\d{4}-\d\d-\d\dT[^ ]+Z )?EP_NATIVE_REPORT_V1=([A-Za-z0-9+/=]{1,43692})$', re.M)
    matches = []
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        entries = z.infolist()
        if len(entries) > 100 or sum(e.file_size for e in entries) > 16 * 1024 * 1024:
            raise ValueError('log_archive_layout')
        for entry in entries:
            if entry.file_size > 4 * 1024 * 1024 or entry.is_dir():
                continue
            raw = z.read(entry)
            matches.extend(marker.findall(raw))
    if len(matches) != 1:
        raise ValueError('log_marker_count')
    decoded = base64.b64decode(matches[0], validate=True)
    if len(decoded) > MAX_JSON:
        raise ValueError('report_size')
    return validate(json.loads(decoded), sha, run_id, platform, attempt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    build = sub.add_parser('finalize')
    build.add_argument('--response', type=Path, required=True)
    build.add_argument('--platform', choices=PLATFORMS, required=True)
    build.add_argument('--runtime', required=True)
    build.add_argument('--exit-code', type=int, required=True)
    reader = sub.add_parser('collect')
    reader.add_argument('--repo', required=True)
    for command in (build, reader):
        command.add_argument('--sha', required=True)
        command.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.mode == 'finalize':
        report = finalize(args.response, args.sha, os.environ.get('GITHUB_RUN_ID', 'local'), args.platform, args.runtime, args.exit_code, int(os.environ.get('GITHUB_RUN_ATTEMPT', '1')))
    else:
        try:
            report = collect(args.repo, args.sha, os.environ['GH_TOKEN'])
        except (OSError, ValueError, KeyError):
            # No sample is explicit; never reuse a previous SHA's evidence.
            report = {'schema': 'ep-native-scout-input-v1', 'sourceSha': args.sha, 'sampleCount': 0,
                      'rejectedCount': 0, 'samples': [], 'collectionStatus': 'unavailable'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    if args.mode == 'finalize':
        summary = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with open(summary, 'a') as stream:
                stream.write('### Native regression evidence\n\n```json\n' + json.dumps(report, indent=2) + '\n```\n')
        encoded = base64.b64encode(json.dumps(report, separators=(',', ':')).encode()).decode()
        print('EP_NATIVE_REPORT_V1=' + encoded)
        return 0 if report['status'] == 'PASS' else 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
