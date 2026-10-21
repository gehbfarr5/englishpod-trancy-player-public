import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from versioning import bump, check, next_semver


class SourceVersionTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for sub in ("release", "flutter_app", "miniprogram"):
            (self.root / sub).mkdir()
        (self.root / "release/versions.json").write_text(json.dumps({
            "schema_version": 1,
            "mobile": {"version": "1.0.0", "build": 1},
            "miniprogram": {"version": "0.2.0", "highest_observed_platform_version": "0.2.0"},
            "web_preview": {"distribution": "prototype", "version": None}
        }), encoding="utf-8")
        (self.root / "flutter_app/pubspec.yaml").write_text(
            "name: englishpod_trancy\nversion: 1.0.0+1\n", encoding="utf-8")
        (self.root / "miniprogram/package.json").write_text(
            '{\n  "name": "englishpod",\n  "version": "0.2.0",\n  "private": true\n}\n',
            encoding="utf-8")
        (self.root / "miniprogram/package-lock.json").write_text(
            '{\n  "name": "englishpod",\n  "version": "0.2.0",\n'
            '  "packages": {\n    "": {\n      "name": "englishpod",\n'
            '      "version": "0.2.0",\n      "license": "MIT"\n    }\n  }\n}\n', encoding="utf-8")

    def test_baseline_and_mobile_version_bump(self):
        self.assertEqual(check(self.root)["mobile"]["build"], 1)
        data = bump(self.root, "mobile", "patch")
        self.assertEqual(data["mobile"], {"version": "1.0.1", "build": 2})
        self.assertIn("version: 1.0.1+2", (self.root / "flutter_app/pubspec.yaml").read_text())
        bump(self.root, "mobile", "build")
        self.assertEqual(check(self.root)["mobile"], {"version": "1.0.1", "build": 3})

    def test_miniprogram_patch_keeps_lock_synchronized(self):
        bump(self.root, "miniprogram", "patch")
        self.assertEqual(check(self.root)["miniprogram"]["version"], "0.2.1")
        self.assertEqual(json.loads((self.root / "miniprogram/package-lock.json").read_text())
                         ["packages"][""]["version"], "0.2.1")

    def test_lock_bump_ignores_dependencies_sharing_the_version(self):
        # Regression: dependencies can share the root's exact version string
        # (real case at 0.3.3: @babel/helper-define-polyfill-provider and
        # babel-plugin-polyfill-corejs2 are both 0.3.3). The nested rewrite
        # must anchor to the ROOT entry (its name line) and touch only that
        # one occurrence.
        lock = (self.root / "miniprogram/package-lock.json").read_text()
        lock = lock.replace(
            '  "packages": {',
            '  "packages": {\n'
            '    "node_modules/some-dep": {\n'
            '      "version": "0.2.0",\n'
            '      "resolved": "https://registry.npmjs.org/some-dep/-/some-dep-0.2.0.tgz"\n'
            '    },',
            1,
        )
        (self.root / "miniprogram/package-lock.json").write_text(lock, encoding="utf-8")
        self.assertIn("some-dep", lock)  # fixture must actually inject the dependency
        bump(self.root, "miniprogram", "patch")
        payload = json.loads((self.root / "miniprogram/package-lock.json").read_text())
        self.assertEqual(payload["packages"][""]["version"], "0.2.1")
        self.assertEqual(payload["packages"]["node_modules/some-dep"]["version"], "0.2.0")

    def test_mismatch_is_blocked_before_bump(self):
        (self.root / "flutter_app/pubspec.yaml").write_text("version: 9.9.9+1\n")
        with self.assertRaises(ValueError):
            check(self.root)
        with self.assertRaises(ValueError):
            bump(self.root, "mobile", "patch")

    def test_web_prototype_and_semver_constraints(self):
        self.assertEqual(next_semver("0.2.0", "minor"), "0.3.0")
        with self.assertRaises(ValueError):
            next_semver("1.2", "patch")
        with self.assertRaises(ValueError):
            bump(self.root, "miniprogram", "build")

    def test_synchronized_source_downgrade_is_blocked_without_writes(self):
        path = self.root / "release/versions.json"
        data = json.loads(path.read_text())
        data["miniprogram"]["highest_observed_platform_version"] = "0.3.1"
        path.write_text(json.dumps(data))
        before = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        with self.assertRaisesRegex(ValueError, "below the observed platform"):
            check(self.root)
        with self.assertRaisesRegex(ValueError, "below the observed platform"):
            bump(self.root, "miniprogram", "patch")
        self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_platform_floor_uses_numeric_semver_order(self):
        path = self.root / "release/versions.json"
        data = json.loads(path.read_text())
        data["miniprogram"]["version"] = "0.10.0"
        data["miniprogram"]["highest_observed_platform_version"] = "0.9.9"
        path.write_text(json.dumps(data))
        for name in ("package.json", "package-lock.json"):
            package_path = self.root / "miniprogram" / name
            package_path.write_text(package_path.read_text().replace('"0.2.0"', '"0.10.0"'))
        self.assertEqual(check(self.root)["miniprogram"]["version"], "0.10.0")
        bumped = bump(self.root, "miniprogram", "patch")
        self.assertEqual(bumped["miniprogram"]["version"], "0.10.1")
        self.assertEqual(bumped["miniprogram"]["highest_observed_platform_version"], "0.9.9")

    def test_missing_or_malformed_platform_floor_fails_closed(self):
        path = self.root / "release/versions.json"
        baseline = json.loads(path.read_text())
        for value in (None, "latest", "0.3", "01.2.3"):
            with self.subTest(value=value):
                data = json.loads(json.dumps(baseline))
                if value is None:
                    del data["miniprogram"]["highest_observed_platform_version"]
                else:
                    data["miniprogram"]["highest_observed_platform_version"] = value
                path.write_text(json.dumps(data))
                with self.assertRaises((KeyError, ValueError)):
                    check(self.root)


if __name__ == "__main__":
    unittest.main()
