"""Synthetic numbers test the analyzer only; they are not product measurements."""
import copy
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from g4_benchmark import METRICS, compare, main, summarize


def report(suite='first_content'):
    return {'schema_version': 1, 'suite': suite,
            'environment': {'sha': 'a' * 40, 'build': 'synthetic-test', 'platform': 'wechat',
                            'device': 'synthetic', 'os': 'synthetic', 'client': 'synthetic',
                            'runtime': 'synthetic', 'network': 'synthetic', 'cache': 'cold',
                            'fixture': 'synthetic-v1', 'lesson_count': 30,
                            'scenario': 'synthetic-only', 'evidence_level': 'L0'},
            'regression_status': 'PASS',
            'samples': [{'id': str(i), 'status': 'PASS',
                         'metrics': {key: (j + 1) * 10 + i for j, key in enumerate(METRICS[suite])}}
                        for i in range(5)]}


class BenchmarkTest(unittest.TestCase):
    def test_median_range_and_no_acceptance_claim(self):
        result = summarize(report())
        self.assertEqual(result['metrics']['play_ms'], {'n': 5, 'median': 62, 'min': 60, 'max': 64})
        self.assertEqual(result['status'], 'READY_FOR_REVIEW')
        self.assertEqual(result['g4_acceptance'], 'NOT_ASSESSED')

    def test_index_detail_overlap_is_allowed(self):
        data = report()
        data['samples'][0]['metrics']['index_ready_ms'] = 35
        self.assertEqual(summarize(data)['passed'], 5)

    def test_failed_attempts_are_preserved_and_not_averaged(self):
        data = report()
        data['samples'].append({'id': 'failure', 'status': 'FAIL', 'metrics': {'play_ms': 9999}})
        result = summarize(data)
        self.assertEqual(result['failed'], 1)
        self.assertAlmostEqual(result['failure_rate'], 1 / 6)
        self.assertEqual(result['metrics']['play_ms']['median'], 62)
        self.assertEqual(result['status'], 'INCOMPLETE_OR_FAILED')

    def test_missing_or_unavailable_metrics_are_not_zero(self):
        data = report('catalog')
        for sample in data['samples']:
            sample['metrics']['peak_memory_bytes'] = None
        result = summarize(data)
        self.assertIsNone(result['metrics']['peak_memory_bytes']['median'])
        self.assertEqual(result['status'], 'INCOMPLETE_OR_FAILED')

    def test_empty_or_four_attempts_are_incomplete(self):
        for count in (0, 4):
            data = report()
            data['samples'] = data['samples'][:count]
            self.assertEqual(summarize(data)['status'], 'INCOMPLETE_OR_FAILED')

    def test_duplicate_attempt_is_rejected(self):
        data = report()
        data['samples'].append(copy.deepcopy(data['samples'][0]))
        with self.assertRaises(ValueError):
            summarize(data)

    def test_invalid_numbers_are_rejected(self):
        for value in (-1, True, float('nan'), float('inf'), 10 ** 400, '10'):
            data = report()
            data['samples'][0]['metrics']['play_ms'] = value
            with self.assertRaises(ValueError):
                summarize(data)

    def test_unknown_fields_and_impossible_timeline_are_rejected(self):
        data = report()
        data['samples'][0]['metrics']['play_ms'] = 1
        with self.assertRaises(ValueError):
            summarize(data)
        data = report()
        data['raw_log'] = 'not benchmark data'
        with self.assertRaises(ValueError):
            summarize(data)

    def test_unrun_or_failed_regression_blocks_readiness(self):
        for status in ('FAIL', 'NOT_TESTED'):
            data = report()
            data['regression_status'] = status
            self.assertEqual(summarize(data)['status'], 'INCOMPLETE_OR_FAILED')

    def test_conditions_cannot_be_mixed(self):
        for key, value in (('cache', 'warm'), ('device', 'other'), ('network', 'other'),
                           ('lesson_count', 335), ('fixture', 'other'), ('evidence_level', 'physical')):
            before, after = report(), report()
            after['environment'].update(sha='b' * 40, **{key: value})
            with self.assertRaisesRegex(ValueError, 'condition mismatch'):
                compare(before, after)

    def test_comparison_reports_signed_delta_without_accepting_g4(self):
        before, after = report(), report()
        after['environment'].update(sha='b' * 40, build='synthetic-after')
        for sample in after['samples']:
            sample['metrics']['play_ms'] += 5
        result = compare(before, after)
        self.assertEqual(result['metrics']['play_ms']['median_delta'], 5)
        self.assertGreater(result['metrics']['play_ms']['median_delta_percent'], 0)
        self.assertEqual(result['g4_acceptance'], 'NOT_ASSESSED')

    def test_same_sha_cannot_be_a_code_improvement_comparison(self):
        with self.assertRaises(ValueError):
            compare(report(), report())

    def test_catalog_uses_its_own_metric_set(self):
        result = summarize(report('catalog'))
        self.assertEqual(result['status'], 'READY_FOR_REVIEW')
        self.assertEqual(set(result['metrics']), set(METRICS['catalog']))
        with self.assertRaisesRegex(ValueError, 'suite mismatch'):
            compare(report(), report('catalog'))

    def test_incomplete_comparison_has_no_delta(self):
        before, after = report(), report()
        after['environment']['sha'] = 'b' * 40
        after['samples'] = after['samples'][:4]
        result = compare(before, after)
        self.assertEqual(result['status'], 'INCOMPLETE_OR_FAILED')
        self.assertIsNone(result['metrics']['play_ms']['median_delta'])

    def test_cli_exit_codes_and_machine_output(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'sample.json'
            for data, expected in ((report(), 0), ({**report(), 'samples': []}, 1), ({}, 2)):
                source.write_text(json.dumps(data), encoding='utf-8')
                output = io.StringIO()
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(main([str(source)]), expected)
                if expected != 2:
                    self.assertEqual(json.loads(output.getvalue())['g4_acceptance'], 'NOT_ASSESSED')


if __name__ == '__main__':
    unittest.main()
