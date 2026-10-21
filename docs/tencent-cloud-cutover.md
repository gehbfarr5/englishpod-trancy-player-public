# Tencent Cloud and GitHub cutover checklist

This repository is the intended public source of truth. The Tencent Cloud environment, COS objects, web hosting, and WeChat Mini Program remain in their current accounts until each connection below is rebound and verified. A GitHub repository change does not transfer Tencent resources.

## Current state

- Sanitized Flutter/Web, Mini Program source, and G4 offline tooling are in this repository.
- GitHub-hosted CI is verified for G4 and Mini Program checks.
- Existing CloudBase/App identifiers in source are integration identifiers, not proof that deployment credentials or trust are connected.
- Course JSON, transcripts, and audio are not in Git. Preserve the licensed corpus in its existing private storage.
- The source repository's OIDC trust subject is tied to the old private repository and does not authorize this repository.
- This public repository does not yet have verified Tencent Web deployment, course-data retrieval, WeChat upload credentials/runner, or production deployment.

## Connection inventory and acceptance

| Connection | Needed in public repository | Acceptance evidence |
| --- | --- | --- |
| GitHub Actions CI | GitHub-hosted runners; no cloud credentials | Required checks pass on a PR and on main |
| COS course reads | Dedicated Tencent CAM OIDC role restricted to the required private audio objects | New-repository OIDC probe, then all expected object sizes and SHA-256 checks pass |
| CloudBase/API | Existing environment, functions, and database remain in Tencent; establish how deployment or runtime access is authenticated | Non-destructive health checks plus lesson-index and representative detail responses |
| Web hosting | A main-only deployment path, private build staging, and least-privilege target credentials or a dedicated runner | Deploy a reversible candidate from this repository; verify URL, version, and rollback |
| WeChat Mini Program | Re-enter WECHAT_CI_PRIVATE_KEY_B64 in the new repository/environment; re-register the dedicated runner if required | Main-only manual development-code upload; confirm the uploaded preview in WeChat DevTools |
| Agent Scout/Builder | Re-enter DEEPSEEK_API_KEY; protected, reviewed workflows and issue approval policy | A no-secret dry run, then one read-only Scout run and one approved draft Builder run |
| Mobile regression | GitHub-hosted Android emulator/iOS simulator; synthetic fixture only | Current-SHA runs execute, produce explicit PASS/FAIL/ERROR evidence; physical-device claims remain separate |

## Required identity changes

The immutable subject for the public repository's main branch is:

    repo:gehbfarr5@111337856/englishpod-trancy-player-public@1428251473:ref:refs/heads/main

Update the Tencent OIDC provider/role trust to this exact subject. Do not allow the old repository as a fallback and do not use static Tencent keys as a fallback. Keep the audio role limited to read-only access to the required private audio objects. That role is not a Web deployment role; create a separate least-privilege identity only if Web deployment needs cloud writes.

The expected OIDC issuer is https://token.actions.githubusercontent.com, with Tencent STS audience sts.tencentcloudapi.com. Only the trusted main-branch job that reads private course data should receive id-token: write. Pull request jobs must not receive cloud identity.

## Credential handling

GitHub does not expose existing secret values for copying. Re-enter values directly in the new repository's Settings → Secrets and variables → Actions (or a protected environment), never in chat, issues, logs, or committed files.

Recreate only secrets that remain necessary after reviewing the corresponding workflow:

- WECHAT_CI_PRIVATE_KEY_B64 — WeChat development-code upload.
- DEEPSEEK_API_KEY — Agent Scout/Builder, only after their workflows are safely migrated and reviewed.
- Any Apple signing material — only if a signing workflow is intentionally restored; signing files are not part of the public repository.
- Tencent static SECRETID/SECRETKEY values are not part of the preferred OIDC design. Do not re-add them unless a separately reviewed, least-privilege exception is approved.

Do not place course JSON/audio in public GitHub Releases or Actions artifacts. Public build output must not contain licensed lesson material. Stage private build inputs from authorized storage and publish only through the intended product delivery path after its access controls are checked.

## Runner and deployment controls

- Re-register the dedicated self-hosted runner for this repository from the host itself using a fresh short-lived registration token. Do not copy a token or runner credential from the old repository.
- Keep only trusted, main-branch workflows on the runner. Never execute pull-request code on it.
- Protect the web-production and wechat-upload environments with required reviewers and branch restrictions where available.
- Use explicit workflow approvals and concurrency controls for deploy/upload operations.
- Keep deployment hostnames, filesystem paths, private IP addresses, and process inspection output out of public workflow files and logs. Put the target URL/path in protected variables or a deployment-side configuration.
- Before switching triggers, test deployment from this repository with a reversible candidate and prove rollback.

## Final cutover and archival gate

Do not archive the private source repository until every applicable item below is verified:

1. Required source, workflow, issue/PR state, and operational documentation have been migrated or deliberately retained privately with a recorded reason.
2. OIDC trust is updated and the public-repository COS probe plus complete private-object integrity check pass.
3. Web deployment from the public repository succeeds, the live site reports the expected version, course loading works through the authorized path, and rollback is proven.
4. WeChat upload from the public repository succeeds and the preview is confirmed.
5. Agent workflows pass security review, use the new repository's secret, and complete a real inference/report handoff.
6. Android emulator and iOS simulator workflows run on the current public-repository SHA. Their evidence does not claim physical-device behavior.
7. Old-repository deployment triggers are disabled or proven inactive, and no active service depends on old-repository secrets, runners, artifacts, or workflow dispatches.
8. Remaining private-only records, licensed artifacts, and historical releases are accounted for and backed up.

At that point, update the private repository landing page to point to this canonical repository, archive it, and verify GitHub reports it as archived. Until then, the private repository remains the rollback record and must not be archived.
