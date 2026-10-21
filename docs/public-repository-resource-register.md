# Public repository resource ownership register

Last reviewed: 2026-10-22

This register tracks the public-repository cutover and where project resources live. GitHub is the canonical source and automation control plane; Tencent remains the runtime, course-data, and Mini Program platform. A resource stays where it is until its replacement is verified and rollback is proven.

## Ownership map

| Resource | Current location and role | Verified state | Next verification |
| --- | --- | --- | --- |
| Source, issues, PRs, CI | This public repository | Public source snapshot; G4, Mini Program, Flutter tests, and a release Web build are covered by GitHub-hosted CI. Flutter/Web PR checks passed; the post-merge main run is queued. Build output is not deployed. | Reconcile only approved, non-sensitive open work; keep licensed content and private discussions private. |
| Course catalog, lesson details, audio | Tencent account B, CloudBase/COS; private licensed data | Read-only inventory previously found 365 detail objects and 365 audio folders. The Oct 17 migration report records size/SHA-256 and decode checks at that time. | Refresh current inventory and hashes; compare the Web-host audio copy against B without changing or copying data. |
| CloudBase functions/database | Tencent account B, existing CloudBase environment | Historical migration checks passed. The latest console still showed data-load/log-service problems; a function test did not provide a verified healthy response. | Restore useful diagnostics and run fresh, non-destructive index and representative detail checks. |
| Web app | Tencent account A, shared host | The Oct 21 console snapshot showed the shared host online. The Web site and audio directory are separate locations on that host, which serves unrelated workloads. | Record deployed source/build version; compare media hashes; create and verify a reversible public-repo deployment candidate before changing the live site. |
| WeChat Mini Program and cloud functions | Tencent account B; source is in this repository | GitHub-hosted source validation passes. The credentialed development upload was skipped; no code upload or DevTools preview is verified. | Configure credentials in protected settings, run the manually gated development upload, and inspect the preview in DevTools. |
| Historical WeChat upload runner | Previously on shared account A host | Public-repository upload workflow now uses GitHub-hosted Ubuntu. No upload was performed. | Keep the old shared-host runner disabled or isolated; confirm no active workflow depends on it. |
| Public-repository Tencent identity | Tencent OIDC | The role trust is set to the exact public main subject. A protected manual-only role-probe workflow is merged; repository variables and the role exchange still need verification. No authenticated COS request is recorded. | Run a protected main-only OIDC probe and a narrowly scoped read test without printing credentials or course data. |
| Agent provider and native CI | GitHub Actions / protected repository settings | The first Android/iOS attempt failed before application tests because the sanitized source omits native platform wrappers. A workflow fix now generates temporary unsigned wrappers on the hosted runner; retry is in progress. No native pass is claimed. No public Scout/Builder workflow or end-to-end run is verified. | Accept the native run, then review a public-specific no-secret dry run and read-only Scout/draft Builder flow. Keep simulator evidence distinct from physical-device tests. |

## Evidence freshness

Historical validation is evidence of the migration at that time, not proof that every current live resource remains unchanged. The Oct 17 report is historical evidence for account B data integrity and CloudBase checks. The Oct 21 Web-host console snapshot showed the shared server online, but did not establish its deployed commit or prove its audio files still match account B.

Before changing any connection, refresh the relevant inventory and retain a sanitized evidence record. Public documentation must not contain host addresses, filesystem paths, internal URLs, course payloads, credentials, runner tokens, or raw device reports.

## Repository boundary

| Area | Canonical destination | Status |
| --- | --- | --- |
| Flutter Web/iOS/Android and WeChat source | This public repository | Source snapshot present; public CI verified |
| G4 checks and tests | This public repository | Offline tests pass on GitHub-hosted Actions |
| Native emulator/simulator tests | This public repository | Workflow added; first run in progress |
| Agent Scout/Builder implementation | This public repository | Not yet migrated or verified |
| Issues, PRs, decisions, open work | Public issues/PRs only after privacy review | Not fully reconciled; do not bulk-copy private discussions |
| Git history, releases, signed builds | Private archive or private artifact storage | Inventory and retention decision required; historical releases may include licensed content |
| Course JSON, transcripts, audio | Existing authorized private Tencent storage | Exclude from Git, public Releases, and public Actions artifacts |
| Credentials, runner registration tokens, signing keys | Protected GitHub settings or host-side secret store | Re-enter/register securely; never commit values |

## Target identity and least privilege

The public repository target is gehbfarr5/englishpod-trancy-player-public, default branch main. Its Tencent OIDC subject is:

    repo:gehbfarr5@111337856/englishpod-trancy-player-public@1428251473:ref:refs/heads/main

The old private repository subject is not a fallback for the public repository. Keep course reads in a dedicated read-only role scoped to required private audio objects. A read role must not deploy to a Web host. If a cloud write is required, use a separate least-privilege identity or host-local deployment mechanism.

## Required sequence

1. Refresh account B inventory and read-only integrity checks; compare the existing Web-host audio copy against B.
2. Verify the public-repository OIDC exchange and narrowly scoped reads without exposing lesson data to public Actions artifacts or logs.
3. Run non-destructive CloudBase health checks for the index and a representative detail.
4. Establish a reversible Web deployment candidate from the public repository; verify routes, course data/audio, cache/version behavior, and rollback before a live switch.
5. Use the public-repository GitHub-hosted path for a manually gated Mini Program development upload, then verify its preview in WeChat DevTools.
6. Migrate and review public Agent Scout/Builder workflows. Run a no-secret dry run, then a protected read-only Scout and reviewed draft Builder.
7. Accept Android Emulator and iOS Simulator checks on a current public SHA. Keep those results separate from iPhone/WeChat and Pixel 3a physical-device checks.
8. Inventory private-only records, releases, artifacts, workflows, and secrets; migrate or document each retained item, then prove no live service or trigger depends on the private repository.
9. Update the private repository landing page, preserve private-only history and licensed artifacts, and archive the old repository as the final acceptance step.

## Credential handling

Create secrets only after confirming the workflow that consumes them:

- WECHAT_CI_PRIVATE_KEY_B64 for an approved Mini Program development upload.
- DEEPSEEK_API_KEY only after the public Agent workflow is reviewed and ready.
- Apple/Android signing secrets only if those workflows are deliberately restored.

Do not ask for secret values in issues, logs, or chat. The owner enters them directly in GitHub or the authenticated Tencent console.
