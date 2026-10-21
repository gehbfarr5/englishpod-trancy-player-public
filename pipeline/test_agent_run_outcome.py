import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "outcome", Path(__file__).resolve().parent / "agent_run_outcome.py"
)
outcome_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(outcome_mod)


class AgentRunOutcomeTests(unittest.TestCase):
    def test_scout_can_record_zero_finding_and_report_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "outcome.json")
            text = outcome_mod.write_outcome(path, "scout", "no_findings")
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
            self.assertEqual(payload["schema"], "ep-agent-run-outcome-v1")
            self.assertEqual(payload["role"], "scout")
            self.assertEqual(payload["outcome"], "no_findings")
            self.assertEqual(text, json.dumps(payload, ensure_ascii=True, sort_keys=True))

    def test_builder_outcomes_cover_plan_category_set(self):
        # Plan section 6 item 7: builder runs must be classifiable as
        # no_task / missing_credentials / inference_failed / no_changes /
        # tests_failed / draft_pr_delivered.
        self.assertEqual(
            sorted(outcome_mod.BUILDER_OUTCOMES),
            sorted(
                [
                    "no_task",
                    "missing_credentials",
                    "inference_failed",
                    "no_changes",
                    "tests_failed",
                    "draft_pr_delivered",
                ]
            ),
        )

    def test_scout_cannot_record_builder_only_outcomes(self):
        with tempfile.TemporaryDirectory() as tmp:
            for bad in ("no_task", "no_changes", "tests_failed", "draft_pr_delivered"):
                with self.assertRaises(ValueError):
                    outcome_mod.write_outcome(
                        str(Path(tmp) / "x.json"), "scout", bad
                    )

    def test_builder_cannot_record_scout_only_outcomes(self):
        with tempfile.TemporaryDirectory() as tmp:
            for bad in ("report_delivered", "no_findings"):
                with self.assertRaises(ValueError):
                    outcome_mod.write_outcome(
                        str(Path(tmp) / "x.json"), "builder", bad
                    )

    def test_unknown_role_or_outcome_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                outcome_mod.write_outcome(str(Path(tmp) / "x.json"), "verifier", "no_task")
            with self.assertRaises(ValueError):
                outcome_mod.write_outcome(str(Path(tmp) / "x.json"), "builder", "merged")

    def test_outcome_records_run_context_without_secret_material(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "outcome.json")
            outcome_mod.write_outcome(path, "builder", "draft_pr_delivered", detail="issue #N")
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
            self.assertEqual(
                sorted(payload),
                ["detail", "outcome", "recordedAtUnix", "role", "runId", "schema", "sha"],
            )
            # runId/sha mirror the ambient Actions environment when present;
            # outside Actions both are None. Never assert the absence of a
            # variable the CI environment does define.
            ambient_run = os.environ.get("GITHUB_RUN_ID")
            if ambient_run is not None:
                self.assertEqual(payload["runId"], ambient_run)
                self.assertRegex(str(payload["sha"]), r"^[0-9a-f]{40}$")
            else:
                self.assertIsNone(payload["runId"])
                self.assertIsNone(payload["sha"])
            self.assertIsInstance(payload["recordedAtUnix"], int)
            self.assertNotIn("token", json.dumps(payload).lower())

    def test_cli_writes_outcome_file(self):
        import subprocess
        import sys

        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "cli-outcome.json")
            script = str(Path(__file__).resolve().parent / "agent_run_outcome.py")
            subprocess.run(
                [sys.executable, script, path, "builder", "tests_failed", "gates log kept"],
                check=True,
            )
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
            self.assertEqual(payload["outcome"], "tests_failed")
            self.assertEqual(payload["detail"], "gates log kept")

    def test_cli_rejects_invalid_usage_loudly(self):
        import subprocess
        import sys

        with tempfile.TemporaryDirectory() as tmp:
            script = str(Path(__file__).resolve().parent / "agent_run_outcome.py")
            result = subprocess.run(
                [sys.executable, script, str(Path(tmp) / "x.json")],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("usage", result.stderr.lower())

    def test_workflows_reference_outcome_helper(self):
        # Contract: both Agent workflows record machine-readable outcomes
        # per plan section 6 item 7; workflow success alone is not product
        # evidence.
        root = Path(__file__).resolve().parents[1]
        scout = (root / ".github" / "workflows" / "agent-scout.yml").read_text()
        builder = (root / ".github" / "workflows" / "agent-builder.yml").read_text()
        for workflow in (scout, builder):
            self.assertIn("agent_run_outcome.py", workflow)
            self.assertIn("missing_credentials", workflow)
        self.assertIn("no_task", builder)
        self.assertIn("no_changes", builder)
        self.assertIn("tests_failed", builder)
        self.assertIn("draft_pr_delivered", builder)
        self.assertIn("report_delivered", scout)
        self.assertIn("inference_failed", scout)
        self.assertIn("inference_failed", builder)
        # Aligned with the merged quota-safe delivery (PR #47): the scout
        # outcome must ride the base64 job-output channel, never the
        # quota-blocked Actions artifact store.
        self.assertNotIn("actions/upload-artifact", scout)
        self.assertNotIn("actions/download-artifact", scout)
        self.assertIn("outcome_b64", scout)
        # Builder outcomes are single-job: no artifact store either
        # (run 39332541897 failed its outcome upload against the quota);
        # both jobs append to $GITHUB_STEP_SUMMARY instead.
        self.assertNotIn("actions/upload-artifact", builder)
        self.assertNotIn("actions/download-artifact", builder)
        self.assertIn("GITHUB_STEP_SUMMARY", builder)
        self.assertGreaterEqual(builder.count("GITHUB_STEP_SUMMARY"), 2)  # select + build

    def test_scout_prompt_requires_dedup_and_stop_conditions(self):
        # Contract per plan section 6 item 5: the Scout prompt must allow
        # zero findings and require dedup, competing explanations, a
        # minimal experiment, and stop conditions.
        root = Path(__file__).resolve().parents[1]
        prompt = (root / ".github" / "prompts" / "scout.md").read_text()
        self.assertIn("Deduplication", prompt)
        self.assertIn("competing explanations", prompt)
        self.assertIn("smallest experiment", prompt)
        self.assertIn("stop conditions", prompt)
        self.assertIn("zero findings is acceptable", prompt)


if __name__ == "__main__":
    unittest.main()
