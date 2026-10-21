import plistlib
import stat
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
from package_unsigned_ipa import APP_PREFIX, package, validate_app, verify_archive
from validate_ios_profile import BUNDLE_ID

class UnsignedIpaTests(unittest.TestCase):
    def make_app(self, root):
        app = root / "Runner.app"
        app.mkdir()
        (app / "Info.plist").write_bytes(plistlib.dumps({
            "CFBundleIdentifier": BUNDLE_ID, "CFBundleExecutable": "Runner"}))
        (app / "Runner").write_bytes(b"fake-binary")
        (app / "Frameworks").mkdir()
        (app / "Frameworks" / "Real.framework").mkdir()
        (app / "Frameworks" / "Real.framework" / "binary").write_bytes(b"data")
        (app / "Frameworks" / "Current.framework").symlink_to("Real.framework")
        return app

    def test_unsigned_ipa_layout_and_symlink(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            out = root / "test.ipa"
            self.assertEqual(package(self.make_app(root), out), BUNDLE_ID)
            self.assertEqual(verify_archive(out), BUNDLE_ID)
            with ZipFile(out) as archive:
                self.assertEqual(archive.read(APP_PREFIX + "/Runner"), b"fake-binary")
                link = archive.getinfo(APP_PREFIX + "/Frameworks/Current.framework")
                self.assertEqual(stat.S_IFMT(link.external_attr >> 16), stat.S_IFLNK)
                self.assertEqual(archive.read(link.filename), b"Real.framework")
                self.assertNotIn(APP_PREFIX + "/embedded.mobileprovision", archive.namelist())

    def test_reject_wrong_bundle(self):
        with TemporaryDirectory() as temp:
            app = self.make_app(Path(temp))
            (app / "Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": "com.example.wrong", "CFBundleExecutable": "Runner"}))
            with self.assertRaises(ValueError):
                validate_app(app)

    def test_reject_existing_signature(self):
        with TemporaryDirectory() as temp:
            app = self.make_app(Path(temp))
            (app / "_CodeSignature").mkdir()
            with self.assertRaises(ValueError):
                validate_app(app)

    def test_missing_executable_and_no_overwrite(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            app = self.make_app(root)
            (app / "Runner").unlink()
            with self.assertRaises(ValueError):
                validate_app(app)
            (app / "Runner").write_bytes(b"ok")
            out = root / "test.ipa"
            out.write_bytes(b"keep")
            with self.assertRaises(ValueError):
                package(app, out)
            self.assertEqual(out.read_bytes(), b"keep")

if __name__ == "__main__":
    unittest.main()
