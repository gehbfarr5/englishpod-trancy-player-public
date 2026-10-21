"""Exchange GitHub OIDC for account-bound, temporary COS credentials.

Uses Tencent's documented STS API and official Python SDK. No static-key
fallback and no response/exception bodies are logged.
"""
import base64
import json
import os
import time
import urllib.parse
import urllib.request

ACCOUNT = "100053564397"
REPOSITORY = "gehbfarr5/englishpod-trancy-player"
ISSUER = "https://token.actions.githubusercontent.com"
AUDIENCE = "sts.tencentcloudapi.com"
SUBJECT_PREFIX = "repo:gehbfarr5@111337856/englishpod-trancy-player@1400689349"
SUBJECT = SUBJECT_PREFIX + ":ref:refs/heads/main"
ROLE = f"qcs::cam::uin/{ACCOUNT}:roleName/englishpod-github-audio-read"
PROVIDER = "englishpod-github-oidc"


class AuthError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AuthError("REDIRECT_REJECTED")


def request_json(request):
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as r:
        body = r.read(1024 * 1024 + 1)
    if len(body) > 1024 * 1024:
        raise AuthError("RESPONSE_TOO_LARGE")
    return json.loads(body)


def validate_context(env):
    if (env.get("GITHUB_ACTIONS") != "true"
            or env.get("GITHUB_REPOSITORY") != REPOSITORY
            or env.get("GITHUB_REF") != "refs/heads/main"
            or env.get("GITHUB_EVENT_NAME") != "workflow_dispatch"):
        raise AuthError("UNTRUSTED_WORKFLOW_CONTEXT")
    url = urllib.parse.urlsplit(env["ACTIONS_ID_TOKEN_REQUEST_URL"])
    if (url.scheme != "https" or not url.hostname
            or not url.hostname.endswith(".actions.githubusercontent.com")
            or url.username or url.password or url.port not in (None, 443)):
        raise AuthError("UNTRUSTED_TOKEN_ENDPOINT")


def validate_claims(token, now=None):
    # Tencent validates the signature. This check rejects unexpected contexts
    # locally before any token is sent to STS; it is not signature verification.
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("INVALID_TOKEN")
    claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    now = time.time() if now is None else now
    if (claims.get("iss") != ISSUER or claims.get("aud") != AUDIENCE
            or claims.get("sub") != SUBJECT
            or claims.get("repository") != REPOSITORY
            or claims.get("exp", 0) <= now):
        raise AuthError("UNTRUSTED_TOKEN_CLAIMS")


def verify_identity(credentials):
    from tencentcloud.common import credential
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.profile.http_profile import HttpProfile
    from tencentcloud.sts.v20180813 import sts_client, models
    profile = ClientProfile(httpProfile=HttpProfile(endpoint="sts.tencentcloudapi.com"))
    client = sts_client.StsClient(credential.Credential(
        credentials["TmpSecretId"], credentials["TmpSecretKey"], credentials["Token"]),
        "ap-shanghai", profile)
    result = client.GetCallerIdentity(models.GetCallerIdentityRequest())
    if result.AccountId != ACCOUNT or result.Type != "CAMRole":
        raise AuthError("WRONG_CALLER_IDENTITY")


def export_credentials(credentials, destination):
    mapping = {"COS_SECRET_ID": "TmpSecretId", "COS_SECRET_KEY": "TmpSecretKey",
               "COS_SESSION_TOKEN": "Token"}
    values = {k: credentials[v] for k, v in mapping.items()}
    if any(not isinstance(v, str) or not v or "\n" in v or "\r" in v
           for v in values.values()):
        raise AuthError("INVALID_CREDENTIAL_RESPONSE")
    for value in values.values():
        print("::add-mask::" + value, flush=True)
    # GitHub's per-step environment file is ephemeral runner state, never an
    # artifact or workspace file. Consumers must not print these variables.
    with open(destination, "a", encoding="utf-8") as f:
        for key, value in values.items():
            f.write(f"{key}={value}\n")


def authenticate(env=os.environ):
    validate_context(env)
    separator = "&" if "?" in env["ACTIONS_ID_TOKEN_REQUEST_URL"] else "?"
    token = request_json(urllib.request.Request(
        env["ACTIONS_ID_TOKEN_REQUEST_URL"] + separator + urllib.parse.urlencode({"audience": AUDIENCE}),
        headers={"Authorization": "Bearer " + env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]}))["value"]
    validate_claims(token)
    body = {"RoleArn": ROLE, "ProviderId": PROVIDER, "DurationSeconds": 1800,
            "RoleSessionName": "englishpod-" + env["GITHUB_RUN_ID"], "WebIdentityToken": token}
    response = request_json(urllib.request.Request("https://sts.tencentcloudapi.com/",
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json",
        "Authorization": "SKIP", "X-TC-Action": "AssumeRoleWithWebIdentity",
        "X-TC-Version": "2018-08-13", "X-TC-Region": "ap-shanghai",
        "X-TC-Timestamp": str(int(time.time()))}))["Response"]
    if "Error" in response or response.get("ExpiredTime", 0) <= time.time():
        raise AuthError("STS_EXCHANGE_REJECTED")
    credentials = response["Credentials"]
    verify_identity(credentials)
    export_credentials(credentials, env["GITHUB_ENV"])
    print(f"PASS: temporary CAM role authenticated to target account {ACCOUNT}; static keys unused.")


if __name__ == "__main__":
    try:
        authenticate()
    except Exception as exc:
        # HTTP/SDK errors can contain JWTs, headers and signed requests.
        category = str(exc) if isinstance(exc, AuthError) else type(exc).__name__
        print("::error::Tencent OIDC authentication failed: " + category)
        raise SystemExit(1)
