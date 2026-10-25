#!/usr/bin/env python3
"""Discover and select a connected physical iOS device (e.g. iPhone 17) for automated regression testing.
Ensures Developer Mode and pairing without logging unique hardware identifiers or learner credentials.
"""
import json
import os
import re
import subprocess
import sys


def run_command(*args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.PIPE)
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        return ""


def find_devices_via_devicectl():
    """Use modern Xcode devicectl to query connected physical iOS devices."""
    raw = run_command("xcrun", "devicectl", "list", "devices", "--json-output", "-")
    if not raw:
        return []
    try:
        data = json.loads(raw)
        result = data.get("result", {}).get("devices", [])
        devices = []
        for d in result:
            hardware = d.get("hardwareProperties", {})
            device_class = hardware.get("deviceType", "") or hardware.get("platform", "")
            # Filter for physical iPhones / iOS devices
            if "iphone" in str(device_class).lower() or d.get("deviceProperties", {}).get("osCategory") == "iOS":
                udid = d.get("identifier", "")
                name = d.get("deviceProperties", {}).get("name", "iPhone")
                os_version = d.get("deviceProperties", {}).get("osVersionNumber", "")
                state = d.get("connectionProperties", {}).get("transportType", "")
                is_paired = d.get("deviceProperties", {}).get("pairingState", "") == "paired"
                developer_mode = d.get("deviceProperties", {}).get("developerModeStatus", "") == "enabled"
                devices.append({
                    "udid": udid,
                    "name": name,
                    "os_version": os_version,
                    "is_paired": is_paired,
                    "developer_mode": developer_mode,
                })
        return devices
    except Exception:
        return []


def find_devices_via_flutter():
    """Fallback query via flutter devices command."""
    raw = run_command("flutter", "devices", "--machine")
    if not raw:
        return []
    try:
        devices = []
        for d in json.loads(raw):
            if d.get("targetPlatform") == "darwin-arm64" or d.get("targetPlatform") == "ios":
                if not d.get("isSupported", True) or d.get("emulator", False):
                    continue
                devices.append({
                    "udid": d.get("id", ""),
                    "name": d.get("name", "iPhone"),
                    "os_version": "",
                    "is_paired": True,
                    "developer_mode": True,
                })
        return devices
    except Exception:
        return []


def main():
    devices = find_devices_via_devicectl()
    if not devices:
        devices = find_devices_via_flutter()

    if not devices:
        sys.stderr.write(
            "ERROR: No connected physical iOS device detected.\n"
            "Please ensure your iPhone is connected via USB/Wi-Fi, unlocked, and Developer Mode is enabled.\n"
        )
        sys.exit(1)

    # Prefer iPhone 17 if specified / connected, otherwise pick the first paired device
    target = next((d for d in devices if "17" in d["name"]), devices[0])
    udid = target["udid"]
    name = target["name"]
    version = target.get("os_version") or "iOS 27.x"
    runtime_desc = f"{name} ({version})".strip()

    print(f"Selected physical device: {runtime_desc}")

    github_env = os.environ.get("GITHUB_ENV")
    if github_env:
        with open(github_env, "a", encoding="utf-8") as stream:
            stream.write(f"NATIVE_DEVICE={udid}\n")
            stream.write(f"NATIVE_RUNTIME={runtime_desc}\n")
    else:
        print(f"export NATIVE_DEVICE='{udid}'")
        print(f"export NATIVE_RUNTIME='{runtime_desc}'")


if __name__ == "__main__":
    main()
