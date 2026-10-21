import unittest
import plistlib
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from types import SimpleNamespace
from zipfile import ZipFile
from validate_ios_profile import BUNDLE_ID, validate, export_options, verify_ipa


class ProfileTests(unittest.TestCase):
    def test_ad_hoc_profile_requires_registered_devices_and_correct_bundle(self):
        p = {"TeamIdentifier": ["TEAM1"],
             "Entitlements": {"application-identifier": "TEAM1." + BUNDLE_ID},
             "ProvisionedDevices": ["example-device"], "UUID": "mock", "Name": "EnglishPod Ad Hoc"}
        good = validate(p, "TEAM1")
        self.assertEqual(export_options(good)["method"], "release-testing")
        with self.assertRaises(ValueError):
            validate(dict(p, ProvisionedDevices=[]), "TEAM1")
        with self.assertRaises(ValueError):
            validate(dict(p, Entitlements={"application-identifier": "TEAM1.invalid"}), "TEAM1")

    def test_xcode_runner_and_runner_tests_use_dedicated_bundle(self):
        project = (Path(__file__).resolve().parents[1] /
                   "flutter_app/ios/Runner.xcodeproj/project.pbxproj").read_text()
        self.assertEqual(project.count("PRODUCT_BUNDLE_IDENTIFIER = " + BUNDLE_ID + ";"), 3)
        self.assertEqual(project.count("PRODUCT_BUNDLE_IDENTIFIER = " + BUNDLE_ID + ".RunnerTests;"), 3)
        self.assertNotIn("com.englishpod.trancy.englishpodTrancy", project)

    def test_exported_ipa_identity_and_profile(self):
        profile = {"TeamIdentifier": ["TEAM1"],
                   "Entitlements": {"application-identifier": "TEAM1." + BUNDLE_ID},
                   "ProvisionedDevices": ["test-device"], "UUID": "mock", "Name": "EnglishPod Ad Hoc"}
        with TemporaryDirectory() as folder:
            ipa = Path(folder) / "EnglishPod.ipa"
            def create_ipa(bundle):
                with ZipFile(ipa, "w") as archive:
                    archive.writestr("Payload/Runner.app/Info.plist",
                                     plistlib.dumps({"CFBundleIdentifier": bundle}))
                    archive.writestr("Payload/Runner.app/embedded.mobileprovision", b"mock")
                    archive.writestr("Payload/Runner.app/_CodeSignature/CodeResources", b"mock")
            create_ipa(BUNDLE_ID)
            with patch("validate_ios_profile.subprocess.run",
                       return_value=SimpleNamespace(stdout=plistlib.dumps(profile))):
                self.assertEqual(verify_ipa(ipa, "TEAM1")["bundle"], BUNDLE_ID)
            create_ipa("com.example.unrelated")
            with self.assertRaises(ValueError):
                verify_ipa(ipa, "TEAM1")


if __name__ == "__main__":
    unittest.main()
