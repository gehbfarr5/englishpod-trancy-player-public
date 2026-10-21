# Tencent Cloud and GitHub cutover checklist

This repository is the intended public source of truth. Tencent CloudBase, COS, Web hosting, and the Mini Program remain in their current accounts until each connection is rebound and verified. A repository change does not transfer cloud resources or licensed content.

## Current state

- Sanitized Flutter/Web, Mini Program source, and G4 offline tooling are present in this repository.
- GitHub-hosted CI is verified for G4 and Mini Program source checks on main. This does not verify a Tencent upload or device preview.
- Account B's course data migration was previously completed and validated: the Oct 17 report records that the expected lesson/audio set passed size/SHA-256 integrity and decode checks, lesson details and index mappings were validated, and existing M4A objects were retained. This is historical migration evidence, not a fresh current-state comparison.
- The Oct 21 console snapshot showed the account A Web host online. It is shared with unrelated workloads. The Web site and its audio directory are separate locations on that same host.
- The Web-host audio copy has not yet been compared against account B's current COS object hashes. Do not re-upload the corpus; first inventory and compare.
- The Tencent role trust subject has been changed to the public repository's `main`; the actual Actions token exchange and authorized course read are not yet verified.
- The public repository has a GitHub-hosted WeChat validation/upload workflow. Source validation passes, but the credentialed upload step is skipped; Tencent Web deployment and production deployment remain unverified.

## Verified status (2026-10-22)

- Public `main` is at `4661b633`. PR #8 added the manual-only Tencent OIDC role-exchange probe; its first main-branch run reached STS but failed with sanitized `MissingParameter`. PR #5 merged the explicit `DurationSeconds: 7200` fix, inferred from Tencent's official SDK request shape. A fresh main-branch probe is still required; no credentials are printed or persisted, and the probe does not test COS access.
- PR #9 adds Flutter tests and a release Web build to CI. On PR #5 head `6973acf`, G4, Mini Program, Flutter tests, and the Web build passed in run #46. This does not deploy the Web app or Mini Program.
- Public main has an active ruleset requiring PRs, up-to-date CI and native checks, and blocking force pushes and branch deletion. GitHub environment restrictions for deployment/resource workflows are still unconfigured/unverified.
- PR #5 is merged. Mobile Regression run #12 passed Android Emulator and iOS Simulator N01/N02 using synthetic WAV. Both reports have exit code 0 and identify the same tested tree `90584754ca94da82798df3b758c77fecc785c7e0`, which matches the current merged main tree. This is simulator evidence only; physical-device acceptance remains open. Earlier failures exposed an AnimatedSwitcher scroll-controller collision and compact-width overflows; the merged fix covers keyed transcript/view transitions and the narrow layout paths.
- The public-repository Tencent OIDC provider and role identifiers are configured as Actions variables. A post-fix main-branch role exchange and a scoped COS read remain unverified.
- PR #3 moved the WeChat development upload job to GitHub-hosted `ubuntu-24.04`. Source validation passes; the protected upload credential is not configured, so no upload or DevTools preview has been verified.
- A read-only CloudBase inventory showed 365 lesson-detail objects and 365 lesson audio folders. The Oct 17 integrity report is historical; current object hashes have not been compared with the Web host's separate audio copy.
- Current CloudBase console observations: the environment overview reported data-load failure and that logging is not enabled; the lesson-index function displays a normal deployment status, while Cloud Studio reports un-deployed workspace changes. No deployment was made and these observations are not an end-to-end health result. The earlier console function test failed; diagnose that before treating CloudBase as healthy.
- PR #11 ports playback reliability improvements (ordered progress writes, bounded audio retry, and expected browser autoplay handling); its public checks are running. Web deployment, Agent Scout/Builder migration, trusted deployment environments, and physical-device acceptance remain open.
- The private repository still contains private-only history and migration-related records. Each retained item and live-service dependency must be inventoried before archival.
- Storage policy compatibility and least-privilege behavior remain unverified. Do not change live access settings until the client access path and rollback have been tested.

## Remaining gates, in execution order

1. Resolve and document the storage authorization model; retain a rollback path and do not publish licensed lesson data in GitHub or Actions artifacts.
2. The role/provider identifiers are configured as repository variables and the DurationSeconds fix is merged. Rerun the main-only OIDC probe, then add a separate scoped COS read check without printing credentials or course contents.
3. Diagnose CloudBase's data-load failure and un-deployed Studio changes; make logs available if appropriate, then run non-destructive health checks for the index and a representative detail.
4. Establish a reversible Web deployment candidate from the public repository; verify routes, course data/audio, cache/version behavior and rollback before any live switch.
5. Configure the protected Mini Program upload credential in public-repository settings, run the manually gated development upload, then verify the resulting preview in WeChat DevTools.
6. Migrate and review Agent Scout/Builder workflows for the public repository. Run a no-secret dry run, then a protected read-only Scout and reviewed draft Builder result; keep the model credential out of PR jobs and logs.
7. Run Android Emulator and iOS Simulator checks on the current public SHA. Keep those results distinct from the recorded iPhone/WeChat and Pixel 3a physical-device checks.
8. Inventory private-only records, releases, artifacts, workflows and secrets; migrate or document each retained item, then prove no live service or trigger depends on the private repository.

The private repository remains the rollback record until these gates have evidence.

## Resource placement

| Resource | Current owner/platform | Migration intent |
| --- | --- | --- |
| Public source, CI and project decisions | This GitHub repository | Canonical code and automation control plane |
| Course catalog/details/audio and CloudBase functions | Tencent account B | Keep private and in place; reconnect through least-privilege identity and verify |
| Web app and its separate audio directory | Tencent account A, shared host | Preserve current service during a static-hosting PoC; move only after parity and rollback are proven |
| WeChat Mini Program runtime | Tencent account B | Keep runtime and data in place; reconnect source-controlled development upload |
| Historical WeChat runner | Shared account A host | Replace with GitHub-hosted execution or a dedicated isolated runner; do not assume the shared host is safe for target-repo jobs |

## Connection inventory and acceptance

| Connection | Required work | Acceptance evidence |
| --- | --- | --- |
| GitHub Actions CI | GitHub-hosted runners; read-only repository permissions for PR jobs | Required checks pass on a PR and on main |
| COS course reads | Dedicated Tencent OIDC role for the exact public repository subject, limited to required private audio reads | OIDC probe succeeds; current expected object inventory and size/SHA checks pass; no licensed data in public logs/artifacts |
| CloudBase/API | Existing environment, functions and database remain in Tencent | Non-destructive health check plus lesson-index and representative detail responses |
| Web hosting | Reversible static-hosting PoC or a separately reviewed deployment path | Verify route handling, audio/data authorization, cache behavior, version reporting and rollback before changing the live host |
| WeChat Mini Program | Re-enter upload credential in protected public-repo settings; use GitHub-hosted or isolated runner | Main-only development upload succeeds and its preview is checked in WeChat DevTools |
| Agent Scout/Builder | Review permissions, prompts and approval policy; add the new secret only when ready | No-secret dry run, read-only Scout completion, reviewed draft Builder result |
| Mobile regression | Android emulator and iOS simulator with synthetic fixtures | Current-SHA workflows report explicit PASS/FAIL/ERROR; physical-device claims remain separate |

## OIDC and credential handling

The immutable subject for the public repository's main branch is:

    repo:gehbfarr5@111337856/englishpod-trancy-player-public@1428251473:ref:refs/heads/main

The expected OIDC issuer is `https://token.actions.githubusercontent.com`, with Tencent STS audience `sts.tencentcloudapi.com`. Grant `id-token: write` only to the trusted main-branch job that needs private course reads. Pull-request jobs must not receive cloud identity.

GitHub secret values are write-only. Re-enter secrets directly in the public repository's protected settings after reviewing the consuming workflow; never put them in chat, issues, logs, or committed files.

- `WECHAT_CI_PRIVATE_KEY_B64` — only for approved Mini Program development uploads.
- `DEEPSEEK_API_KEY` — only after Agent workflows are safely migrated and reviewed.
- Apple signing material — only if signing workflows are intentionally restored.
- The repository still contains a legacy CloudBase ingestion script that accepts Tencent API key environment variables. It is not used by the current CI workflows; before any future upload use, keep it off public Actions and run it only with narrowly scoped, short-lived credentials in a trusted environment. Do not add static Tencent `SECRETID/SECRETKEY` as an OIDC substitute.

Do not place course JSON/audio in public GitHub Releases or Actions artifacts. Public build output must not contain licensed lesson material. Stage private build inputs from authorized storage and publish only through an access-controlled product path.

## Runner and deployment controls

- Re-register a runner only from its host using a fresh short-lived registration token.
- Never run untrusted pull-request code on a self-hosted runner.
- The public-repository WeChat workflow now uses a GitHub-hosted runner. The historical runner on the shared host remains untrusted until it is disabled or isolated.
- Protect production and upload environments with branch restrictions, approvals, concurrency controls, and main-only workflows.
- Keep hostnames, filesystem paths, private addresses, and process inspection output out of public source and logs.
- Test a reversible candidate and prove rollback before switching any live trigger.

## Final cutover and archival gate

Do not archive the private source repository until all applicable items are verified:

1. Source, workflows, and operational docs are migrated or deliberately retained privately with a reason.
2. Public-repository OIDC works; current private-object inventory/integrity and authorized course reads pass.
3. Web deployment from the public repository works; live version, routes, course loading, access controls, cache behavior, and rollback are verified.
4. Mini Program development upload from the public repository succeeds and the preview is confirmed.
5. Agent workflows pass security review and complete a real read-only report and reviewed draft proposal.
6. Android emulator and iOS simulator workflows run on the current public SHA, with no claim that this proves physical-device behavior.
7. Old-repository triggers are disabled or proven inactive; no live service depends on old-repository secrets, runners, artifacts, or dispatches.
8. Private-only records, licensed artifacts, and historical releases are accounted for and backed up.

Only then update the private repository landing page, archive it, and verify GitHub reports it as archived. Until that final gate, keep it as the rollback record.
