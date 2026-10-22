import base64
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import tencent_oidc as auth


def token(**changes):
    claims = dict(iss=auth.ISSUER, aud=auth.AUDIENCE, sub=auth.SUBJECT,
                  repository=auth.REPOSITORY, exp=9999999999)
    claims.update(changes)
    return "header." + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=") + ".signature"


class OidcTests(unittest.TestCase):
    def environment(self, destination):
        return dict(GITHUB_ACTIONS="true", GITHUB_REPOSITORY=auth.REPOSITORY,
                    GITHUB_REF="refs/heads/main", GITHUB_EVENT_NAME="workflow_dispatch",
                    ACTIONS_ID_TOKEN_REQUEST_URL="https://example.actions.githubusercontent.com/idtoken?api-version=1",
                    ACTIONS_ID_TOKEN_REQUEST_TOKEN="request-secret", GITHUB_RUN_ID="123",
                    GITHUB_ENV=str(destination))

    def test_rejects_other_repo_branch_and_token_host(self):
        for key, value in [("GITHUB_REPOSITORY", "other/repo"), ("GITHUB_REF", "refs/heads/feature"),
                           ("GITHUB_EVENT_NAME", "pull_request"),
                           ("ACTIONS_ID_TOKEN_REQUEST_URL", "https://attacker.example/token")]:
            env = self.environment("unused")
            env[key] = value
            with self.subTest(key=key), patch.object(auth, "request_json") as request:
                with self.assertRaises(auth.AuthError):
                    auth.authenticate(env)
                request.assert_not_called()

    def test_rejects_wrong_or_expired_claims(self):
        for change in [dict(iss="https://other"), dict(aud="other"), dict(sub="repo:other/repo"),
                       dict(repository="other/repo"),
                       dict(sub=f"repo:{auth.REPOSITORY}:ref:refs/heads/main"),
                       dict(sub=auth.SUBJECT.replace("1428251473", "1428251474")), dict(exp=1)]:
            with self.subTest(change=change), self.assertRaises(auth.AuthError):
                auth.validate_claims(token(**change))

    def test_exchange_verifies_identity_before_export(self):
        credentials = dict(TmpSecretId="test-id", TmpSecretKey="test-secret", Token="test-session")
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "env"
            replies = [{"value": token()}, {"Response": {
                "ExpiredTime": 9999999999, "Credentials": credentials}}]
            with patch.object(auth, "request_json", side_effect=replies) as request, \
                    patch.object(auth, "verify_identity") as verify, redirect_stdout(io.StringIO()):
                auth.authenticate(self.environment(destination))
            verify.assert_called_once_with(credentials)
            body = json.loads(request.call_args_list[1].args[0].data)
            self.assertEqual(body["RoleArn"], auth.ROLE)
            self.assertEqual(body["DurationSeconds"], 1800)
            self.assertIn("COS_SESSION_TOKEN=test-session", destination.read_text())

    def test_wrong_account_never_exports_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "env"
            replies = [{"value": token()}, {"Response": {"ExpiredTime": 9999999999,
                "Credentials": dict(TmpSecretId="id", TmpSecretKey="key", Token="token")}}]
            with patch.object(auth, "request_json", side_effect=replies), \
                    patch.object(auth, "verify_identity", side_effect=auth.AuthError("WRONG_CALLER_IDENTITY")), \
                    self.assertRaises(auth.AuthError):
                auth.authenticate(self.environment(destination))
            self.assertFalse(destination.exists())

    def test_multiline_credentials_rejected_before_mask_or_export(self):
        with redirect_stdout(io.StringIO()) as output, self.assertRaises(auth.AuthError):
            auth.export_credentials(dict(TmpSecretId="id", TmpSecretKey="key\nINJECT=1", Token="token"), "unused")
        self.assertEqual(output.getvalue(), "")

    def test_redirects_fail_closed(self):
        with self.assertRaises(auth.AuthError):
            auth.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://other")


if __name__ == "__main__":
    unittest.main()
