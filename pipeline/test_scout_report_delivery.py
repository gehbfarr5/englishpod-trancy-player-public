import re
import unittest
from pathlib import Path


class ScoutReportDeliveryContractTests(unittest.TestCase):
    """Contract tests for the quota-safe scout report delivery fix.

    Evidence: on 2026-10-19, Scout run 39284173180 completed the GLM-5.2
    inference but the report upload failed with "Artifact storage quota
    has been hit. Unable to upload any new artifacts." — the account's
    existing ~2.4 GB IPA/APK artifacts count against the quota and even
    a ~4 KB report upload is rejected. The fix (this branch) routes the
    report through a base64 job output to the privileged issue-writing
    job, deleting no existing artifacts and changing no billing settings.
    """

    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        self.workflow = (root / ".github" / "workflows" / "agent-scout.yml").read_text()

    def test_no_artifact_store_dependency_for_scout_report(self):
        self.assertNotIn("actions/upload-artifact", self.workflow)
        self.assertNotIn("actions/download-artifact", self.workflow)

    def test_report_flows_through_base64_job_output(self):
        self.assertIn("report_b64", self.workflow)
        self.assertIn("base64 -w0", self.workflow)
        self.assertIn("base64 -d", self.workflow)
        # The analyze job must declare the output for the report job.
        outputs_block = re.search(r"analyze:.*?steps:", self.workflow, re.S)
        self.assertIsNotNone(outputs_block)
        self.assertIn("report_b64:", outputs_block.group(0))

    def test_issue_writer_stays_separate_and_privileged(self):
        # Only the report job holds issues:write; the workflow-level and
        # analyze-job grants stay read-only for issues.
        self.assertIn("permissions:\n  contents: read\n  issues: read", self.workflow)
        report_start = self.workflow.index("  report:")
        analyze_block = self.workflow[self.workflow.index("  analyze:"):report_start]
        report_block = self.workflow[report_start:]
        self.assertNotIn("issues: write", analyze_block)
        self.assertIn("issues: write", report_block)
        self.assertIn("Maintain single scout tracking issue", report_block)

    def test_report_job_guards_on_delivered_output(self):
        self.assertIn(
            "needs.analyze.outputs.report_b64 != ''",
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main()
