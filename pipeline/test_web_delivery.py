import json
from pathlib import Path
import tempfile
import unittest
import hashlib
import zipfile

from deploy_web import activate, current_target, rollback
from prepare_web_build import stage
from web_bundle import seal, verify
from web_release import pack, unpack


class WebDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def bundle(self, label, sha, run):
        folder = self.root / label
        for file in ('index.html', 'flutter_bootstrap.js', 'main.dart.js',
                     'assets/assets/lessons_safe/index.json'):
            path = folder / file
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('[]' if file.endswith('.json') else 'fixture')
        version = self.root / 'version.json'
        version.write_text(json.dumps({'version': '0.1.0', 'build': 1}))
        seal(folder, version, sha, run)
        return folder

    def test_tampering_or_wrong_provenance_never_changes_live_pointer(self):
        site = self.root / 'site'
        original = self.bundle('a', 'a' * 40, '1')
        activate(site, original, 'a' * 40, '1', lambda *_: None)
        before = current_target(site)
        broken = self.bundle('b', 'b' * 40, '2')
        with self.assertRaises(ValueError):
            activate(site, broken, 'a' * 40, '1', lambda *_: None)
        (broken / 'main.dart.js').write_text('tampered')
        with self.assertRaises(ValueError):
            activate(site, broken, 'b' * 40, '2', lambda *_: None)
        self.assertEqual(before, current_target(site))

    def test_health_failure_restores_previous_then_explicit_rollback_works(self):
        site = self.root / 'site'
        first = self.bundle('a', 'a' * 40, '1')
        second = self.bundle('b', 'b' * 40, '2')
        activate(site, first, 'a' * 40, '1', lambda *_: None)
        self.assertEqual((site / 'current').readlink().parts[0], 'releases')
        before = current_target(site)
        def fail(*_):
            raise ValueError('served a stale build')
        with self.assertRaises(ValueError):
            activate(site, second, 'b' * 40, '2', fail)
        self.assertEqual(before, current_target(site))
        activate(site, second, 'b' * 40, '2', lambda *_: None)
        rollback(site, lambda sha, run: self.assertEqual((sha, run), ('a' * 40, '1')))
        self.assertEqual(before, current_target(site))

    def test_media_debug_files_and_symlinks_cannot_be_sealed(self):
        bundle = self.bundle('a', 'a' * 40, '1')
        for filename in ('audio.mp3', 'main.dart.js.map'):
            path = bundle / filename
            path.write_text('private')
            with self.assertRaises(ValueError):
                verify(bundle, 'a' * 40, '1')
            path.unlink()
        (bundle / 'link').symlink_to(self.root)
        with self.assertRaises(ValueError):
            verify(bundle, 'a' * 40, '1')

    def test_seal_removes_flutter_build_bookkeeping_and_renderer_maps(self):
        bundle = self.bundle('a', 'a' * 40, '1')
        (bundle / '.last_build_id').write_text('flutter bookkeeping')
        (bundle / 'renderer.js.map').write_text('debug symbols')
        seal(bundle, self.root / 'version.json', 'a' * 40, '1')
        self.assertFalse((bundle / '.last_build_id').exists())
        self.assertFalse((bundle / 'renderer.js.map').exists())
        verify(bundle, 'a' * 40, '1')

    def test_web_stage_excludes_legacy_metadata_and_bundled_audio(self):
        repo = self.root / 'repo'
        app = repo / 'flutter_app'
        (app / 'assets/lessons').mkdir(parents=True)
        (app / 'assets/audio/0001').mkdir(parents=True)
        (app / 'assets/audio/0001/dg.mp3').write_bytes(b'not for frontend bundle')
        (repo / 'release').mkdir()
        (repo / 'release/web.json').write_text('{"version":"0.1.0","build":1}')
        (app / 'pubspec.yaml').write_text('version: 1.0.1+2\nflutter:\n  assets:\n    - assets/lessons_safe/\n    - assets/audio/0001/\n')
        audio = {'dg': '/private/source/lesson_dg.mp3', 'pb': '/private/source/lesson_pb.mp3'}
        (app / 'assets/lessons/index.json').write_text(json.dumps([{'lesson_id': '0001', 'audio': audio}]))
        (app / 'assets/lessons/lesson_0001.json').write_text(json.dumps({'LessonId': '0001', 'audio': audio}))
        output = self.root / 'staged'
        stage(repo, output, expected_count=1)
        self.assertFalse((output / 'assets/audio').exists())
        self.assertFalse((output / 'assets/lessons').exists())
        self.assertNotIn('assets/audio/', (output / 'pubspec.yaml').read_text())
        safe = json.loads((output / 'assets/lessons_safe/lesson_0001.json').read_text())
        self.assertEqual(safe['audio']['dg'], 'lesson_dg.mp3')

    def test_private_release_archive_roundtrip_and_digest_rejection(self):
        bundle = self.bundle('a', 'a' * 40, '1')
        archive = self.root / 'web.zip'
        info = pack(bundle, archive, 'a' * 40, '1', self.root / 'metadata.json')
        with self.assertRaises(ValueError):
            unpack(archive, self.root / 'bad', 'a' * 40, '1', '0' * 64)
        output = self.root / 'unpacked'
        unpack(archive, output, 'a' * 40, '1', info['archive_sha256'])
        self.assertEqual((bundle / 'main.dart.js').read_bytes(),
                         (output / 'main.dart.js').read_bytes())

    def test_release_path_traversal_is_rejected_before_extraction(self):
        archive = self.root / 'unsafe.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('../outside.txt', 'unsafe')
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        with self.assertRaises(ValueError):
            unpack(archive, self.root / 'out', 'a' * 40, '1', digest)
        self.assertFalse((self.root / 'outside.txt').exists())


if __name__ == '__main__':
    unittest.main()
