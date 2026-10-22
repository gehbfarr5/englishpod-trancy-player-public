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

- Latest recheck: PR #20 is merged at `f4c31d0ed8cb965a1a484cb3c2967ae56b58946b`; all six required checks passed, including Android/iOS simulator checks and Mini Program source checks. Protected-main Tencent OIDC run `39715428993` passed. Its logged result explicitly says COS was not tested. Read-only CAM policy inspection confirms `GetObject` on the target audio prefix only; no bucket-list action is granted. The separate COS read and current Web-host/COS hash reconciliation remain open.
- Fresh read-only CloudBase console check for account B shows `lessons_index` with 335 records across 34 pages; visible records contain the expected audio/file reference fields, including the current key `audio/0001/dg.mp3`. The console still warns that database rollback is disabled and the built-in instance is shared. This proves index presence and a current object reference only: application data loading, representative course-detail health, and COS object read/hash remain unverified. No course text was expanded or copied, and no database/function/Studio change was made.
- A code review found `pipeline/tencent_oidc.py` still pinned its local workflow-context checks to the old private repository even though the main probe is now public. This helper has not been used for the successful STS run. It is being corrected and unit-tested before it can safely support a dedicated COS probe. The old Oct 17 manifest is historical and is not evidence of today's COS inventory.
- Account mapping correction: the current Tencent console identity was compared with the private migration record `docs/account-migration.md`. It matches the documented Mini Program/course-data target account B; the separate personal account A is the account named in the dated shared-Web-host audit. Earlier public Issue #6 commentary incorrectly labeled the current account A and said B had not been inspected. That was an identity-mapping error; the public correction is being recorded separately without publishing full account identifiers.
- Read-only account-B inspection found the documented CloudBase environment in Shanghai and its CloudBase-managed COS bucket. The bucket root showed `audio/`, `brand/`, and `lessons/`; the `audio/` prefix showed 336 entries. A single lesson folder metadata check showed two MP3 objects and their sizes. No object content was opened or downloaded. This is a partial inventory only: no complete object size/hash comparison has run, and it does not prove GitHub OIDC access.
- The previous account-B CloudBase document-database check also found `lessons_index` with 335 records; see the fresh console check above for today's revalidation. The earlier application data-load failure remains unverified.
- On the public main SHA `735e9f8c0c79f261affcf9c73ef18e987460d19a`, credential-free Builder dry-run run `39707977672` passed and Mini Program verify run `39707980758` passed; the upload job was skipped as intended. Agent Scout run `39707638423` completed without a DeepSeek secret: credential check passed as a missing-secret condition and inference/report steps were skipped. These results verify safe no-credential paths only.
- The post-merge main Mobile Regression run `39705479053` failed on Android while iOS passed. On PR #19's head, Android passed and iOS passed on the second attempt (`39708210925`, attempt 2); the first iOS attempt timed out before scenarios ran. These were synthetic-audio cloud simulator checks, not physical-device acceptance.
- Fresh protected-main OIDC probe run `39704247372` on public main SHA `c56d6f509906b6c4373d0e473f72e92ccbd3d676` reached Tencent STS but failed with the sanitized error code `MissingParameter`, even with `DurationSeconds: 7200`. No temporary credentials were printed or used; COS access was not tested. Trust configuration is not runtime acceptance. The public repository currently has the two expected OIDC variables and no Actions secrets; no credential values are included here.
- PR #19 added the documented Shanghai `X-TC-Region` header, but a fresh protected-main probe (`39713123031`, main SHA `16763b2a`) still returned sanitized `MissingParameter`; no temporary credentials were printed or used and COS was not tested. A comparison with [Tencent's common API parameters](https://cloud.tencent.com/document/api/1312/48201) and the existing private OIDC client found the public request also omitted required `X-TC-Timestamp`. PR #20 adds the current Unix timestamp header; this is a testable diagnosis, not yet a successful exchange.
- Earlier main Mobile Regression runs on older SHAs had Android/iOS failures. PR #19's synthetic-audio simulator run passed both platforms after one iOS timeout/retry; a fresh main simulator run on merge commit `16763b2a` is still running. No physical-device acceptance is implied.
- The authenticated Tencent console was read-only inspected through local Chrome and identified the Mini Program/course-data account B by matching the private migration record. The earlier public note that labeled this session account A was incorrect. Account A's shared Web host was not inspected or changed in this session.
- A read-only GitHub inventory reconfirmed the private repository remains private and unarchived, with 14 active workflow definitions, 73 branches, 14 prerelease Web ZIPs, and one online, idle self-hosted runner. The private Web deployment workflow remains active and targets the shared-host runner label; a workflow-run-triggered deployment job completed on 2026-10-21. This is evidence of a configured and recently executing deployment path, not proof of current live traffic, and it blocks runner retirement and archival pending dependency review.

- Public `main` is protected by required CI/native checks, PR-only updates, and rules preventing force-pushes and branch deletion. PR #13 (guarded Agent Scout/Builder workflows and policy tests) is merged at `6f381f5d`; PR #11 (playback reliability) is merged at `ef98c67e`.
- Public continuation CI run #60 passed on PR #11's rebased head, including G4, Mini Program checks, Flutter/Web tests, and Agent policy tests. Mobile Regression run #24 passed Android and iOS simulator scenarios N01/N02 on the same tested tree `75062e4d9a4f492fe31fd0833c188c78a42ff503`. The iOS simulator was iPhone 17 / iOS 26.5; both platforms used synthetic WAV. This is simulator evidence only, not physical-device or licensed-catalog acceptance.
- The Agent workflows are guarded and their policy tests pass. No real DeepSeek inference, read-only Scout report, or reviewed Builder draft is evidenced yet; these still require a protected main-branch run with the configured model credential and trusted environment.
- The Tencent OIDC trust subject targets the public repository's `main`, but a successful protected-main token exchange and a separate scoped COS read are not yet verified. Do not infer resource access from the trust-policy configuration alone.
- CloudBase health remains unverified. Prior read-only console observations reported a data-load failure and undeployed Studio workspace changes; no new deployment or end-to-end health result is recorded.
- The public repository contains a WeChat source-validation/upload workflow, but no credentialed upload or WeChat DevTools preview is evidenced. Web deployment from this repository, route/audio/cache verification, rollback, and public deployment-environment restrictions also remain open.
- The private inventory still includes 13 workflow files, 14 generated Web ZIP prereleases, and 73 branch refs. They have not all been migrated or dispositioned, and no-live-dependency proof is outstanding. Keep licensed artifacts and private-only history in the private repository until their inventory and retention review is complete.
- The old private README notice PR could not pass its required checks because the checks failed before runner startup; no runner steps ran. The private repository remains unarchived.
- Private PR #69 has been closed as migrated to public PR #11. Public issues #12, #14, #15, and #16 track remaining playback, Mini Program, physical WeChat, and signed-iOS work.

## Remaining gates, in execution order

1. STS/OIDC now passes from protected public `main`: PR #20 merged at `f4c31d0ed8cb965a1a484cb3c2967ae56b58946b`; main run `39715428993` completed successfully. That workflow explicitly reports `COS_ACCESS=NOT_TESTED`. The read-only CAM policy inspection confirms the role is limited to `GetObject` on the target audio prefix and has no list permission. A current object key is confirmed by the CloudBase index, but its current size/hash have not been checked. PR #21 fixes the reusable OIDC helper; the COS probe is being added separately and uses the existing GetObject permission only. Do not expand permissions or treat the October 17 manifest as current evidence.
2. Diagnose the prior CloudBase data-load failure and undeployed Studio changes, then complete non-destructive index and representative-detail health checks with a usable diagnostic trail.
3. Reconcile the Web host's separate audio directory against current COS object hashes. Complete content/license review and document resource ownership before any copy or publication.
4. Build a reversible Web deployment candidate from this repository; verify routes, catalog/audio access, cache/version behavior, and rollback before changing live traffic.
5. Configure the protected Mini Program upload credential, run the development upload from this repository, and verify its preview in WeChat DevTools.
6. Exercise Scout/Builder on protected `main`: complete a no-secret dry run, a real read-only Scout report, and a reviewed draft Builder result. Keep model credentials out of PR jobs and logs.
7. Complete physical acceptance on the recorded iPhone 17 (iOS 27.0.1, WeChat 8.0.79) and Pixel 3a. Simulator checks already pass and do not replace these checks; do not send licensed sample audio or learner telemetry to CI.
8. Finish the private inventory of workflows, releases, artifacts, branches, secrets, and service triggers. Migrate or document each retained item and verify that no live service depends on the private repository. The private README notice remains blocked by required checks that failed before runner startup.
9. Once the resource, workflow, inventory, and physical-device gates above have evidence, update the private repository landing page, archive the private repository, and verify its archived state.

The private repository remains the rollback record until all preceding gates have evidence.

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
