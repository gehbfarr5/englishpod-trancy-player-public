#!/usr/bin/env python3
"""Determine which maintained client suites a change can affect."""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Iterable

CLIENTS = ("ios", "android", "web", "miniprogram")
ALL_CLIENTS_ON_CHANGE = {
    ".github/workflows/ci.yml",
    ".github/workflows/mobile-regression.yml",
    "pipeline/affected_clients.py",
    "pipeline/test_affected_clients.py",
}
FLUTTER_SHARED_PATHS = {
    ".github/scripts/run-native-regression.sh",
    "pipeline/native_test_evidence.py",
    "pipeline/prepare_native_test_assets.py",
    "pipeline/prepare_flutter_lessons.py",
    "pipeline/select_ios_simulator.py",
}


def affected_clients(paths: Iterable[str]) -> dict[str, bool]:
    changed = {path.replace("\\", "/").removeprefix("./") for path in paths}
    if any(path in ALL_CLIENTS_ON_CHANGE for path in changed):
        return {client: True for client in CLIENTS}

    flutter_changed = any(path.startswith("flutter_app/") for path in changed) or bool(
        changed & FLUTTER_SHARED_PATHS
    )
    miniprogram_changed = any(path.startswith("miniprogram/") for path in changed) or (
        ".github/workflows/wechat-preview.yml" in changed
    )
    return {
        "ios": flutter_changed,
        "android": flutter_changed,
        "web": flutter_changed,
        "miniprogram": miniprogram_changed,
    }


def changed_paths() -> list[str] | None:
    """Return changed paths for this event; None means run all client suites."""
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    if event == "workflow_dispatch":
        return None

    head = os.environ.get("CLIENT_TEST_HEAD_SHA") or os.environ.get("GITHUB_SHA", "")
    if event == "pull_request":
        base = os.environ.get("CLIENT_TEST_BASE_SHA", "")
    elif event == "push":
        base = os.environ.get("CLIENT_TEST_BEFORE_SHA", "")
        if not base or set(base) == {"0"}:
            return None
    else:
        return None

    if not base or not head:
        return None
    result = subprocess.run(
        ["git", "diff", "--name-only", "-z", base, head],
        check=True,
        capture_output=True,
    )
    return [path.decode("utf-8") for path in result.stdout.split(b"\0") if path]


def main() -> int:
    paths = changed_paths()
    outputs = {client: True for client in CLIENTS} if paths is None else affected_clients(paths)
    output_file = os.environ.get("GITHUB_OUTPUT")
    lines = [f"{client}={'true' if outputs[client] else 'false'}" for client in CLIENTS]
    if output_file:
        with open(output_file, "a", encoding="utf-8") as stream:
            stream.write("\n".join(lines) + "\n")
    else:
        print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
