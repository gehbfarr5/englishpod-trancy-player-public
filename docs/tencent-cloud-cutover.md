# Tencent Cloud cutover checklist for the public repository

This repository contains sanitized application source and G4 tooling. It does not move or recreate any Tencent Cloud resource. The existing Web host, CloudBase environment, COS objects, and WeChat Mini Program remain in their current accounts; GitHub workflows must be rebound to them.

## What is staged

- Web player source and Mini Program source are in this repository.
- The Mini Program's non-secret CloudBase/App configuration is retained for the current service integration.
- The lesson corpus, audio files, old Git history, deployment logs, and server-specific deployment scripts are excluded.
- Pull-request and G4 CI runs use GitHub-hosted runners and do not need cloud credentials.

## Required cutover work

1. Recreate required GitHub Actions secrets in this repository. GitHub does not allow exporting secret values from the old repository:
   - `TENCENTCLOUD_SECRETID`
   - `TENCENTCLOUD_SECRETKEY`
   - `WECHAT_CI_PRIVATE_KEY_B64`
2. Add non-secret variables needed for the chosen Tencent Cloud environment, region, and Web deployment target.
3. Rebuild the Web asset preparation step so it fetches authorized lesson JSON from the existing CloudBase/COS environment at build time. Do not add the corpus or audio to Git.
4. Add protected, main-branch-only deployment workflows for the existing Web host and WeChat development-code upload.
5. Re-register or authorize a dedicated self-hosted runner only after deployment jobs are restricted to trusted main-branch workflows. No pull-request job may use this runner.
6. Verify deployment from this repository with a small, reversible release before switching the old private repository's deployment trigger.

## Operational boundary

- GitHub-hosted jobs can run G4 checks without cloud credentials.
- Web deployment and WeChat upload are separate operations from source migration. They must not run until the new repository's secrets, variables, runner access, and public workflow protections are verified.
- WeChat upload remains a manual operation from the protected default branch. It does not submit a review or publish a production release.
- Public repository visibility does not authorize redistribution of EnglishPod course material. The corpus remains out of Git until the rights and delivery path are confirmed.
