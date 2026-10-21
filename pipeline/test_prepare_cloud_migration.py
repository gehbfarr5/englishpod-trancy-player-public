import gzip
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from prepare_cloud_migration import prepare, verify


class MigrationPreparationTests(unittest.TestCase):
    def test_original_bytes_timing_and_target_bound_resume(self):
        # Synthetic local unit fixtures, never migration source media.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, out = root / "source", root / "prepared"
            source.mkdir()
            audio = {}
            original = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"fixture" * 400
            for track in ("dg", "pb"):
                path = source / f"source-{track}.mp3"
                path.write_bytes(original)
                audio[track] = str(path)
            index = [{"lesson_id": "0001", "lesson_number": 1, "audio": audio}]
            detail = {"LessonId": "0001", "audio": audio,
                      "tracks": {"dg": [{"start": 1.25, "end": 2.75, "text": "Hello"}], "pb": []}}
            (source / "index.json").write_text(json.dumps(index))
            (source / "lesson_0001.json").write_text(json.dumps(detail))
            target = ("test-env", "abcd-test-env-1503148834", "100053564397")
            manifest = prepare(source, out, *target, expected_count=1)
            self.assertEqual(len(manifest["objects"]), 2)
            self.assertEqual((out / "audio/0001/dg.mp3").read_bytes(), original)
            clean = json.loads(gzip.decompress((out / "lessons/0001.json.gz").read_bytes()))
            self.assertEqual(clean["tracks"], detail["tracks"])
            self.assertEqual(clean["audio"]["dg"], "audio/0001/dg.mp3")
            blob = (out / "lessons_index.ndjson").read_text()
            self.assertNotIn(str(source), blob)
            self.assertIn("cloud://test-env.abcd-test-env-1503148834/audio/0001/pb.mp3", blob)
            self.assertEqual(verify(out, out / "manifest.json"), 2)
            self.assertEqual(prepare(source, out, *target, expected_count=1), manifest)
            with self.assertRaisesRegex(ValueError, "target mismatch"):
                prepare(source, out, "test-env", target[1], "100011870048", expected_count=1)
            dest = out / "audio/0001/dg.mp3"
            dest.write_bytes(original[:-1] + b"z")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                verify(out, out / "manifest.json")


if __name__ == "__main__":
    unittest.main()
