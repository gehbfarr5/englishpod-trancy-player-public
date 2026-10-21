"""Machine-readable Agent run outcome classification.

Per docs/iteration-plan-2026-10-19.md section 6 (G0 item 7): workflow
success alone is not evidence of product improvement. Each Agent Scout /
Agent Builder run must end with a structured outcome so downstream
tooling and humans can distinguish:

  - no_task            : no approved [agent-ready] issue was available
  - missing_credentials: OPENCODE_API_KEY absent; agent inactive
  - inference_failed   : OpenCode errored or returned no completed text
  - no_changes         : Builder produced zero file changes (rejected)
  - tests_failed       : independent gates failed; no PR delivered
  - draft_pr_delivered : Builder pushed a branch and opened a draft PR
  - report_delivered   : Scout produced a report artifact (scout only)
  - no_findings        : Scout found no worthwhile task (scout only)

The outcome is a tiny JSON file written next to the workflow's logs; it
is metadata about the run, not product evidence, and it must never be
used to claim a device-verified behavior or a merged change.
"""
from __future__ import annotations

import json
import os
import time

VALID_OUTCOMES = (
    "no_task",
    "missing_credentials",
    "inference_failed",
    "no_changes",
    "tests_failed",
    "draft_pr_delivered",
    "report_delivered",
    "no_findings",
)

SCOUT_OUTCOMES = (
    "missing_credentials",
    "inference_failed",
    "report_delivered",
    "no_findings",
)

BUILDER_OUTCOMES = (
    "no_task",
    "missing_credentials",
    "inference_failed",
    "no_changes",
    "tests_failed",
    "draft_pr_delivered",
)


def write_outcome(path: str, role: str, outcome: str, detail: str = "") -> str:
    """Write a machine-readable outcome file for one Agent run.

    role must be "scout" or "builder"; outcome must be valid for that
    role. Returns the canonical JSON text. Raises ValueError on invalid
    input so misconfigured workflows fail loudly instead of silently
    recording an unusable classification.
    """
    if role not in ("scout", "builder"):
        raise ValueError(f"unknown role: {role}")
    allowed = SCOUT_OUTCOMES if role == "scout" else BUILDER_OUTCOMES
    if outcome not in allowed:
        raise ValueError(f"outcome {outcome!r} not valid for role {role}")
    payload = {
        "schema": "ep-agent-run-outcome-v1",
        "role": role,
        "outcome": outcome,
        "runId": os.environ.get("GITHUB_RUN_ID"),
        "sha": os.environ.get("GITHUB_SHA"),
        "recordedAtUnix": int(time.time()),
        "detail": detail,
    }
    text = json.dumps(payload, ensure_ascii=True, sort_keys=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return text


def main() -> None:
    """CLI: python3 pipeline/agent_run_outcome.py <path> <role> <outcome> [detail]."""
    import sys

    args = sys.argv[1:]
    if len(args) not in (3, 4):
        raise SystemExit(
            "usage: agent_run_outcome.py <output-path> <scout|builder> "
            "<outcome> [detail]"
        )
    write_outcome(args[0], args[1], args[2], args[3] if len(args) == 4 else "")


if __name__ == "__main__":
    main()
