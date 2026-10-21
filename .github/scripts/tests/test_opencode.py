import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("runner", Path(__file__).parents[1] / "run-opencode.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class OpenCodeTests(unittest.TestCase):
    def test_official_deepseek_only_and_no_shell_or_sharing(self):
        for role in runner.MODELS:
            policy = runner.config(role)
            self.assertEqual(policy["enabled_providers"], ["deepseek"])
            self.assertEqual(policy["share"], "disabled")
            self.assertEqual(policy["provider"]["deepseek"]["options"]["baseURL"], "https://api.deepseek.com/v1")
            self.assertEqual(policy["provider"]["deepseek"]["options"]["apiKey"], "{env:DEEPSEEK_API_KEY}")
            self.assertEqual(runner.MODELS[role], "deepseek/deepseek-flash")
            self.assertEqual(policy["permission"]["bash"], "deny")
            self.assertEqual(policy["permission"]["external_directory"], "deny")
        self.assertEqual(runner.config("scout")["permission"]["edit"], "deny")

    def test_builder_workflow_fails_on_empty_approved_task(self):
        workflow = (Path(__file__).parents[2] / "workflows" / "agent-builder.yml").read_text()
        self.assertIn("secrets.DEEPSEEK_API_KEY", workflow)
        self.assertNotIn("secrets.OPENCODE_API_KEY", workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn("--label agent-ready", workflow)
        self.assertIn("owner-managed agent-ready label", workflow)
        self.assertIn("python3 pipeline/versioning.py check", workflow)
        self.assertIn("git diff --cached --quiet; then", workflow)
        self.assertIn("Builder produced no proposed changes", workflow)
        self.assertIn("No model call or repository write will occur in dry-run mode.", workflow)
        block = workflow.split("if git diff --cached --quiet; then", 1)[1].split("\n          fi", 1)[0]
        self.assertIn("exit 1", block)
        self.assertNotIn("exit 0", block)

    def test_scout_uses_only_official_deepseek_secret(self):
        workflow = (Path(__file__).parents[2] / "workflows" / "agent-scout.yml").read_text()
        self.assertIn("secrets.DEEPSEEK_API_KEY", workflow)
        self.assertNotIn("secrets.OPENCODE_API_KEY", workflow)
        self.assertIn("refs/heads/main", workflow)
        self.assertNotIn("issue12", workflow.lower())

    def test_missing_secret_stops_before_model_call(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.md"
            argv = ["run-opencode.py", "scout", str(output)]
            with patch.dict(os.environ, {}, clear=True), patch.object(sys, "argv", argv):
                with self.assertRaises(SystemExit) as error:
                    runner.main()
            self.assertIn("DEEPSEEK_API_KEY is required", str(error.exception))
            self.assertFalse(output.exists())

    def test_public_work_index_is_schema_checked_and_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "index.json"
            path.write_text(json.dumps({
                "schema": "ep-public-work-index-v1",
                "openIssues": [{"number": 12, "title": "untrusted prompt text"}],
            }))
            result = runner.load_public_work_index(path)
            self.assertEqual(result["openIssues"][0]["number"], 12)
            path.write_text("x" * 32769)
            with self.assertRaises(SystemExit):
                runner.load_public_work_index(path)

    def test_scout_index_contains_titles_only(self):
        workflow = (Path(__file__).parents[2] / "workflows" / "agent-scout.yml").read_text()
        self.assertIn('"number,title,labels"', workflow)
        self.assertIn('"number,title,mergedAt"', workflow)
        self.assertNotIn('"number,title,body"', workflow)
        self.assertIn("public-work-items.json", workflow)

    def test_completed_response(self):
        events = [{"type": "text", "part": {"text": "report"}}, {"type": "step_finish"}]
        self.assertEqual(runner.extract("\n".join(map(json.dumps, events))), "report")

    def test_provider_errors_are_not_success(self):
        with self.assertRaises(RuntimeError):
            runner.extract(json.dumps({"type": "error", "error": {"message": "sensitive"}}))

    def test_incomplete_or_empty_response_fails(self):
        for events in ["", '{"type":"text","part":{"text":"partial"}}', '{"type":"step_finish"}']:
            with self.assertRaises(RuntimeError):
                runner.extract(events)


if __name__ == "__main__":
    unittest.main()

