"""Offline G4 sample validation. No device access, telemetry or acceptance claims."""
import argparse
import json
import math
import re
import statistics
import sys
from pathlib import Path

METRICS = {
    'first_content': ('index_ready_ms', 'detail_ready_ms', 'transcript_ready_ms',
                      'audio_load_ms', 'canplay_ms', 'play_ms'),
    'catalog': ('model_build_ms', 'first_render_ms', 'filter_ms',
                'scroll_expand_ms', 'payload_bytes', 'peak_memory_bytes'),
}
ENV_KEYS = {'sha', 'build', 'platform', 'device', 'os', 'client', 'runtime',
            'network', 'cache', 'fixture', 'lesson_count', 'scenario', 'evidence_level'}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def exact_keys(value, keys, name):
    require(isinstance(value, dict) and set(value) == set(keys),
            f'{name}: expected keys {sorted(keys)}')


def valid_metric(value):
    if value is None:
        return True
    if type(value) not in (int, float) or value < 0:
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def summarize(data):
    exact_keys(data, {'schema_version', 'suite', 'environment', 'regression_status', 'samples'}, 'report')
    require(type(data['schema_version']) is int and data['schema_version'] == 1, 'schema_version must be 1')
    suite = data['suite']
    require(isinstance(suite, str) and suite in METRICS, 'unknown suite')
    env = data['environment']
    exact_keys(env, ENV_KEYS, 'environment')
    for key in ENV_KEYS - {'lesson_count'}:
        require(isinstance(env[key], str) and bool(env[key].strip()), f'environment.{key} must be nonempty')
    require(re.fullmatch(r'[0-9a-f]{40}', env['sha']) is not None, 'sha must be a full lowercase Git SHA')
    require(type(env['lesson_count']) is int and env['lesson_count'] > 0, 'lesson_count must be positive')
    require(env['cache'] in ('cold', 'warm'), 'cache must be cold or warm')
    require(env['evidence_level'] in ('L0', 'L1', 'L2', 'physical'), 'unknown evidence_level')
    require(data['regression_status'] in ('PASS', 'FAIL', 'NOT_TESTED'), 'invalid regression_status')
    samples = data['samples']
    require(isinstance(samples, list) and len(samples) <= 1000, 'samples must be a list of at most 1000 attempts')
    values = {key: [] for key in METRICS[suite]}
    seen = set()
    passed = 0
    for sample in samples:
        exact_keys(sample, {'id', 'status', 'metrics'}, 'sample')
        attempt_id = sample['id']
        require(isinstance(attempt_id, str) and bool(attempt_id.strip()) and attempt_id not in seen,
                'sample IDs must be nonempty and unique')
        seen.add(attempt_id)
        require(sample['status'] in ('PASS', 'FAIL'), 'sample status must be PASS or FAIL')
        metrics = sample['metrics']
        require(isinstance(metrics, dict) and set(metrics) <= set(values), 'unknown metric')
        for key, value in metrics.items():
            require(valid_metric(value),
                    f'{key} must be null or a finite nonnegative number')
        if sample['status'] == 'PASS':
            passed += 1
            for key in values:
                value = metrics.get(key)
                if value is not None:
                    values[key].append(value)
            if suite == 'first_content':
                # Index and detail overlap. Do not require index <= detail or add them.
                load = metrics.get('audio_load_ms')
                for key in ('index_ready_ms', 'detail_ready_ms'):
                    value = metrics.get(key)
                    require(load is None or value is None or load >= value,
                            f'audio_load_ms precedes {key}')
                for key in ('canplay_ms', 'play_ms'):
                    value = metrics.get(key)
                    require(load is None or value is None or value >= load,
                            f'{key} precedes audio_load_ms')
    stats = {}
    for key, numbers in values.items():
        stats[key] = {'n': len(numbers), 'median': statistics.median(numbers) if numbers else None,
                      'min': min(numbers) if numbers else None, 'max': max(numbers) if numbers else None}
    failed = len(samples) - passed
    sufficient = all(value['n'] >= 5 for value in stats.values())
    ready = sufficient and not failed and data['regression_status'] == 'PASS'
    return {'suite': suite, 'environment': dict(env), 'attempts': len(samples),
            'passed': passed, 'failed': failed, 'failure_rate': failed / len(samples) if samples else None,
            'regression_status': data['regression_status'], 'metrics': stats,
            'status': 'READY_FOR_REVIEW' if ready else 'INCOMPLETE_OR_FAILED',
            'g4_acceptance': 'NOT_ASSESSED'}


def compare(before, after):
    left, right = summarize(before), summarize(after)
    require(left['suite'] == right['suite'], 'suite mismatch')
    # Only the tested source/build may change in a before/after experiment.
    for key in ENV_KEYS - {'sha', 'build'}:
        require(left['environment'][key] == right['environment'][key], f'condition mismatch: {key}')
    require(left['environment']['sha'] != right['environment']['sha'], 'comparison needs different source SHAs')
    deltas = {}
    for key in METRICS[left['suite']]:
        a, b = left['metrics'][key], right['metrics'][key]
        enough = a['n'] >= 5 and b['n'] >= 5
        deltas[key] = {'before': a, 'after': b,
                       'median_delta': b['median'] - a['median'] if enough else None,
                       'median_delta_percent': (b['median'] - a['median']) / a['median'] * 100
                       if enough and a['median'] != 0 else None}
    return {'before': left, 'after': right, 'metrics': deltas,
            'status': 'READY_FOR_REVIEW' if all(x['status'] == 'READY_FOR_REVIEW' for x in (left, right))
            else 'INCOMPLETE_OR_FAILED', 'g4_acceptance': 'NOT_ASSESSED'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path, nargs='?')
    args = parser.parse_args(argv)
    try:
        before = json.loads(args.before.read_text(encoding='utf-8'))
        result = compare(before, json.loads(args.after.read_text(encoding='utf-8'))) if args.after else summarize(before)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0 if result['status'] == 'READY_FOR_REVIEW' else 1
    except (OSError, ValueError, TypeError) as error:
        print(f'Invalid benchmark: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
