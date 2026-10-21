#!/usr/bin/env python3
"""Check Ad Hoc provisioning profile against the tracked Flutter iOS bundle."""
import json
from pathlib import Path
import plistlib
import sys
import subprocess
import tempfile
from zipfile import ZipFile

BUNDLE_ID = "com.jin.englishpod.trancyplayer"


def validate(profile, team):
    ids = profile.get("TeamIdentifier", [])
    identifier = profile.get("Entitlements", {}).get("application-identifier", "")
    devices = profile.get("ProvisionedDevices", [])
    if (team not in ids or identifier != team + "." + BUNDLE_ID
            or not isinstance(devices, list) or not devices
            or not profile.get("UUID") or not profile.get("Name")
            or profile.get("ProvisionsAllDevices")):
        raise ValueError("profile does not match the app, team, or registered devices")
    return {"team": team, "uuid": profile["UUID"], "name": profile["Name"], "bundle": BUNDLE_ID}


def export_options(data):
    return {"method": "release-testing", "signingStyle": "manual", "teamID": data["team"],
            "provisioningProfiles": {data["bundle"]: data["name"]}}


def verify_ipa(ipa_path, team):
    """Verify exported IPA identity and embedded Ad Hoc profile, without unpacking media."""
    with ZipFile(ipa_path) as archive:
        info = plistlib.loads(archive.read("Payload/Runner.app/Info.plist"))
        if info.get("CFBundleIdentifier") != BUNDLE_ID:
            raise ValueError("IPA Bundle ID does not match the Xcode project")
        archive.getinfo("Payload/Runner.app/_CodeSignature/CodeResources")
        mobileprovision = archive.read("Payload/Runner.app/embedded.mobileprovision")
    with tempfile.TemporaryDirectory() as tmp:
        profile_path = Path(tmp) / "profile.mobileprovision"
        profile_path.write_bytes(mobileprovision)
        decoded = subprocess.run(
            ["security", "cms", "-D", "-i", str(profile_path)],
            check=True, capture_output=True,
        ).stdout
    return validate(plistlib.loads(decoded), team)


def main():
    try:
        if len(sys.argv) != 4:
            raise ValueError("invalid arguments")
        if sys.argv[1] == "--export-options":
            item = json.loads(Path(sys.argv[2]).read_text())
            with Path(sys.argv[3]).open("wb") as f:
                plistlib.dump(export_options(item), f)
            print("Manual Ad Hoc export options prepared.")
        elif sys.argv[1] == "--verify-ipa":
            verify_ipa(sys.argv[2], sys.argv[3])
            print("Exported IPA Bundle ID and embedded device profile verified.")
        else:
            data = validate(plistlib.loads(Path(sys.argv[1]).read_bytes()), sys.argv[2])
            Path(sys.argv[3]).write_text(json.dumps(data))
            print("Ad Hoc device profile matches tracked app identifier.")
    except Exception:
        print("FAIL: invalid Apple signing configuration (details redacted).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
