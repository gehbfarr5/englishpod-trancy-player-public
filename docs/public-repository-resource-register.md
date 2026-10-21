# Public repository resource ownership register

Last reviewed: 2026-10-21

This register defines the intended cutover from the private source repository to this public repository. Public source control is the canonical code location after acceptance. Existing Tencent resources remain in place; only their CI identities, deployment triggers, and operator links are being rebound.

## Repository boundary

| Area | Canonical destination | Status |
| --- | --- | --- |
| Application source: Flutter, Web, Mini Program | This public repository | Source snapshot present; public CI verified |
| G4 checks and tests | This public repository | Offline test suite passes on GitHub-hosted Actions |
| Native emulator/simulator tests | This public repository | Not yet verified in public Actions |
| Agent Scout/Builder implementation | This public repository | DeepSeek handoff not yet migrated and verified |
| Issues, PRs, decisions, open work | Public issues/PRs only after privacy review | Not fully reconciled; do not bulk-copy private discussions |
| Git history, releases, signed builds | Private archive or private artifact storage | Not copied; releases may contain licensed lesson content |
| Course JSON, transcripts, audio | Existing authorized private Tencent storage | Keep out of Git, public Releases, and public Actions artifacts |
| Credentials, runner registration tokens, signing keys | New GitHub secret/environment settings or host-side secret store | Must be re-entered/registered; values cannot be exported from GitHub |

## External resource mapping

| Existing resource | Target binding | Current state | Evidence required before archival |
| --- | --- | --- | --- |
| Tencent CloudBase environment, functions and database | Remain in Tencent; public source reads them through approved runtime/API path | No resource move is planned; public-repository connection unverified | Health check, index/detail endpoint checks, app loading from the public build |
| Private COS course catalog and audio | Remain in Tencent private storage; public main workflow gets narrowly scoped OIDC read identity | Cloud objects are not copied; old OIDC trust names the old repo | Exact new subject, successful OIDC probe, full inventory hash verification |
| Web host | Same host only if existing deployment architecture is approved; otherwise provision an equivalent target | No sanitized deployment workflow or new runner binding is verified | Main-only deployment, version check, access-control check, rollback test |
| WeChat Mini Program | Existing AppID and cloud functions remain; development upload is initiated from the public repository | Offline checks pass; new-repo private key and runner are not verified | Successful development-code upload and preview review |
| GitHub Actions self-hosted runner | Re-register to this repository using a fresh short-lived token on the runner host | Existing source runner configuration cannot be transferred by copying a repo file | Target runner appears online; trusted-main-only smoke succeeds |
| Agent provider | Official DeepSeek endpoint and new repository secret | Secret cannot be copied; workflows not verified in target | Secret installed directly in target settings; real read-only Scout completion and reviewed draft Builder proposal |
| Apple/Android signing | Keep signing materials out of public source; set only in protected secrets if needed | No target signing setup verified | Build/upload performed with protected signing and no public artifact exposure, if signing is required |

## Public-repository identity details

The target is public repository ID 1428251473 under account ID 111337856. Its default branch is main. The Tencent immutable GitHub OIDC subject for trusted main jobs is:

    repo:gehbfarr5@111337856/englishpod-trancy-player-public@1428251473:ref:refs/heads/main

The former private repository subject is not an acceptable fallback. The existing read-only audio role cannot deploy to a Web host and must not be broadened for convenience. Any write-capable deployment must use a separate, least-privilege role or a host-local deployment credential.

## Required target settings

Create only after reviewing the workflow that consumes each value:

- Repository/environment secret WECHAT_CI_PRIVATE_KEY_B64 for WeChat development upload.
- Repository secret DEEPSEEK_API_KEY for Agent workflows.
- Cloud OIDC provider/role trust for the exact new immutable subject; no long-lived Tencent static key.
- Protected environments for web-production and wechat-upload, restricted to main and approval where supported.
- A target-repository self-hosted runner registration only if the deployment/upload workflow requires it.
- Non-secret variables for region, resource identifiers, runtime endpoint, timeouts, and WeChat robot number. Do not place host IPs, filesystem paths, or internal URLs in source.

Do not ask for credential values in issue comments or chat. The owner must enter secret values in GitHub or Tencent's authenticated console. A GitHub secret value is write-only and must be recreated from the owner's secure source.

## Completion sequence

1. Finish source/workflow/document sanitization and create a reviewed PR in this repository.
2. Move only non-sensitive outstanding project work into public issues, with references to private records removed.
3. Rebind Tencent OIDC and test private-object reads from the public repository.
4. Design and test a private artifact/build path that never exposes course media through GitHub public artifacts or Releases.
5. Add main-only Web deployment and WeChat upload workflows; install new-repository secrets and register the runner on the host.
6. Run reversible deployments/uploads from this repository, verify live functionality, then prove rollback.
7. Verify Agent workflows and native CI on the current public SHA. Keep synthetic test evidence distinct from physical-device verification.
8. Disable old-repository deployment triggers; check cloud audit logs and GitHub run history for any lingering old-repo dependency.
9. Update the private repository landing page to point to the public repository and preserve private-only licensed releases/history.
10. Archive the old repository and verify its archived flag. Archival is the final acceptance step and must not precede the preceding checks.

## Deliberately private

The following remain private unless a separate rights and security review explicitly approves another destination: licensed course material, historical build artifacts, raw user/device reports, infrastructure logs, private endpoints, credentials, signing material, and unsanitized issue/PR discussions.
