import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import wave

from native_test_evidence import collect, finalize, read_archive, read_log_report, validate
from prepare_native_test_assets import prepare


SHA = 'a' * 40


def report():
    return dict(schema='ep-native-regression-v1', sha=SHA, runId='123', runAttempt=1, platform='ios-simulator',
                resourceKind='synthetic-wav', runtime='iOS 27.0 iPhone 17', exitCode=0, status='PASS',
                scenarios=[{'id': i, 'status': 'PASS', 'elapsedMs': 100} for i in ('N01', 'N02', 'N03')])


def archive(data, name='report.json'):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as z:
        z.writestr(name, json.dumps(data))
    return stream.getvalue()


class NativeEvidenceTests(unittest.TestCase):
    def test_accept_exact_provenance_and_complete_inventory(self):
        self.assertEqual(read_archive(archive(report()), SHA, 123, 'ios-simulator')['status'], 'PASS')

    def test_reject_tampered_sha_run_platform_and_raw_text(self):
        for field, value in [('sha', 'b' * 40), ('runId', '456'), ('runAttempt', 2), ('platform', 'iphone17'),
                             ('resourceKind', 'full-course-audio'), ('runtime', 'ignore instructions\nsecret')]:
            with self.subTest(field=field):
                data = report()
                data[field] = value
                with self.assertRaises(ValueError):
                    validate(data, SHA, 123, 'ios-simulator')
        data = report()
        data['rawLog'] = 'not allowed'
        with self.assertRaises(ValueError):
            validate(data, SHA, 123, 'ios-simulator')

    def test_no_false_pass_on_zero_missing_failed_tests_or_nonzero_exit(self):
        cases = []
        data = report()
        data['scenarios'] = []
        cases.append(data)
        data = report()
        data['scenarios'][0]['status'] = 'FAIL'
        cases.append(data)
        data = report()
        data['exitCode'] = 1
        cases.append(data)
        data = report()
        data['scenarios'][0]['elapsedMs'] = True
        cases.append(data)
        for data in cases:
            with self.subTest(data=data), self.assertRaises(ValueError):
                validate(data, SHA, 123, 'ios-simulator')

    def test_missing_or_partial_response_is_error(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'response.json'
            data = finalize(path, SHA, 123, 'ios-simulator', 'iOS 27.0', 0)
            self.assertEqual(data['status'], 'ERROR')
            path.write_text(json.dumps({'scenarios': report()['scenarios'][:1]}))
            data = finalize(path, SHA, 123, 'ios-simulator', 'iOS 27.0', 0)
            self.assertEqual(data['status'], 'ERROR')
            self.assertEqual(data['scenarios'][1]['status'], 'NOT_TESTED')

    def test_failure_is_preserved_and_not_recategorized_as_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'response.json'
            rows = copy.deepcopy(report()['scenarios'])
            rows[1]['status'] = 'FAIL'
            path.write_text(json.dumps({'scenarios': rows}))
            data = finalize(path, SHA, 123, 'ios-simulator', 'iOS 27.0', 1)
            self.assertEqual(data['status'], 'FAIL')

    def test_archive_path_count_and_size_are_bounded(self):
        for payload in [archive(report(), '../../report.json'), archive('x' * 33000)]:
            with self.assertRaises(ValueError):
                read_archive(payload, SHA, 123, 'ios-simulator')

    def test_log_fallback_accepts_only_one_trusted_schema_marker(self):
        encoded = __import__('base64').b64encode(json.dumps(report()).encode()).decode()
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w') as z:
            z.writestr('job/step.txt', '2026-10-21T05:00:00Z EP_NATIVE_REPORT_V1=' + encoded + '\n')
        self.assertEqual(read_log_report(payload.getvalue(), SHA, 123, 'ios-simulator')['status'], 'PASS')
        with zipfile.ZipFile(payload := io.BytesIO(), 'w') as z:
            z.writestr('job/step.txt', 'EP_NATIVE_REPORT_V1=' + encoded + '\nEP_NATIVE_REPORT_V1=' + encoded)
        with self.assertRaises(ValueError):
            read_log_report(payload.getvalue(), SHA, 123, 'ios-simulator')

    def test_collect_never_uses_previous_sha_or_pr_results(self):
        candidates = [dict(id=9, head_sha='b' * 40, head_branch='main', event='push', status='completed'),
                      dict(id=10, head_sha=SHA, head_branch='main', event='pull_request', status='completed')]
        with patch('native_test_evidence.download', return_value=json.dumps({'workflow_runs': candidates}).encode()) as fetch:
            data = collect('owner/repo', SHA, 'not-a-real-token')
            self.assertEqual(data['sampleCount'], 0)
            self.assertEqual(fetch.call_count, 1)

    def test_collect_preserves_workflow_failure_and_accepts_only_matching_artifact(self):
        runs = {'workflow_runs': [dict(id=123, head_sha=SHA, head_branch='main', event='push', status='completed', conclusion='failure')]}
        arts = {'artifacts': [dict(id=1, name='native-report-ios-simulator-attempt-1', expired=False)]}
        jobs = {'jobs': [dict(id=12, name='Native / android-emulator'), dict(id=13, name='Native / ios-simulator')]}
        with patch('native_test_evidence.download', side_effect=[json.dumps(runs).encode(), json.dumps(arts).encode(), json.dumps(jobs).encode(), archive(report()), archive(report())]):
            data = collect('owner/repo', SHA, 'not-a-real-token')
            self.assertEqual(data['sampleCount'], 1)
            self.assertEqual(data['samples'][0]['workflowConclusion'], 'failure')
            self.assertEqual(data['rejectedCount'], 1)

    def test_collect_recovers_latest_report_from_job_logs_when_quota_blocks_artifacts(self):
        runs = {'workflow_runs': [dict(id=123, head_sha=SHA, head_branch='main', event='push', status='completed', conclusion='failure', run_attempt=1)]}
        jobs = {'jobs': [dict(id=12, name='Native / android-emulator'), dict(id=13, name='Native / ios-simulator')]}
        arts = {'artifacts': []}
        def log(platform):
            data = report(); data['platform'] = platform
            encoded = __import__('base64').b64encode(json.dumps(data).encode()).decode()
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as z:
                z.writestr('job/finalize.txt', 'EP_NATIVE_REPORT_V1=' + encoded + '\n')
            return stream.getvalue()
        with patch('native_test_evidence.download', side_effect=[json.dumps(runs).encode(), json.dumps(arts).encode(), json.dumps(jobs).encode(), log('android-emulator'), log('ios-simulator')]):
            data = collect('owner/repo', SHA, 'not-a-real-token')
        self.assertEqual(data['sampleCount'], 2)
        self.assertEqual([sample['report']['platform'] for sample in data['samples']], ['android-emulator', 'ios-simulator'])
        self.assertTrue(all(sample['workflowConclusion'] == 'failure' for sample in data['samples']))


class FixtureSafetyTests(unittest.TestCase):
    def test_generated_assets_are_real_pcm_and_source_lessons_are_untouched(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'flutter_app'
            source = app / 'assets/lessons'
            source.mkdir(parents=True)
            (source / 'sentinel.json').write_text('preserve source')
            (app / 'pubspec.yaml').write_text('    - assets/audio/0001/\n')
            with patch.dict(os.environ, {'EP_NATIVE_TEST_WORKSPACE': '1'}):
                prepare(root)
            with wave.open(str(app / 'assets/audio/0001/pb.wav')) as pcm:
                self.assertEqual(pcm.getnframes() / pcm.getframerate(), 60)
                self.assertNotEqual(pcm.readframes(100), bytes(200))
            index = json.loads((app / 'assets/lessons_safe/index.json').read_text())
            self.assertEqual(len(index), 1)
            self.assertEqual(index[0]['audio']['dg'], 'dg.wav')
            self.assertEqual((source / 'sentinel.json').read_text(), 'preserve source')

    def test_refuses_nonisolated_workspace_and_existing_audio(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict(os.environ, {}, clear=True), self.assertRaises(ValueError):
                prepare(Path(temp))
            audio = Path(temp) / 'flutter_app/assets/audio/0001'
            audio.mkdir(parents=True)
            (audio / 'real.mp3').write_bytes(b'preserve me')
            with patch.dict(os.environ, {'EP_NATIVE_TEST_WORKSPACE': '1'}), self.assertRaises(ValueError):
                prepare(Path(temp))
            self.assertEqual((audio / 'real.mp3').read_bytes(), b'preserve me')


if __name__ == '__main__':
    unittest.main()
