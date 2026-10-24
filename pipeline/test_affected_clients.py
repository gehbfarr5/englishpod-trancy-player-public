import unittest

from affected_clients import affected_clients


class AffectedClientsTests(unittest.TestCase):
    def test_miniprogram_only_change_runs_only_miniprogram_suite(self):
        self.assertEqual(
            affected_clients(["miniprogram/pages/m1Experiment/index.ts"]),
            {"ios": False, "android": False, "web": False, "miniprogram": True},
        )

    def test_flutter_change_runs_each_flutter_client_suite(self):
        self.assertEqual(
            affected_clients(["flutter_app/lib/services/transcript_navigation.dart"]),
            {"ios": True, "android": True, "web": True, "miniprogram": False},
        )

    def test_shared_native_fixture_change_runs_all_flutter_clients(self):
        self.assertEqual(
            affected_clients(["pipeline/prepare_native_test_assets.py"]),
            {"ios": True, "android": True, "web": True, "miniprogram": False},
        )

    def test_test_workflow_change_runs_all_client_suites(self):
        self.assertEqual(
            affected_clients([".github/workflows/mobile-regression.yml"]),
            {"ios": True, "android": True, "web": True, "miniprogram": True},
        )

    def test_unrelated_docs_do_not_run_client_suites(self):
        self.assertEqual(
            affected_clients(["docs/product/miniprogram-rebuild-plan.md"]),
            {"ios": False, "android": False, "web": False, "miniprogram": False},
        )

    def test_wechat_ci_workflow_runs_miniprogram_suite(self):
        self.assertEqual(
            affected_clients([".github/workflows/wechat-preview.yml"]),
            {"ios": False, "android": False, "web": False, "miniprogram": True},
        )


if __name__ == "__main__":
    unittest.main()
