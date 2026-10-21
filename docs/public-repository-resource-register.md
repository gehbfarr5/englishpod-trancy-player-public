# Public repository resource ownership register

Last reviewed: 2026-10-21

This register tracks the public-repository cutover and where project resources live. GitHub is the canonical source and automation control plane; Tencent remains the runtime, course-data, and Mini Program platform. A resource stays where it is until its replacement is verified and rollback is proven.

## Ownership map

| Resource | Current location and role | Verified state | Next verification |
| --- | --- | --- | --- |
| Source, issues, PRs, CI | This public repository | Public source snapshot and GitHub-hosted offline checks are present. | Reconcile only approved, non-sensitive open work; keep licensed content and private discussions private. |
| Course catalog, lesson details, audio | Tencent account B, CloudBase/COS; private licensed data | The Oct 17 migration report records that the expected lesson/audio set was migrated and passed size/SHA-256 integrity and decode checks. Lesson details, index/FileID mappings, and CloudBase function calls were validated. Existing M4A objects were retained unchanged. | Refresh current B-side object counts and hashes; verify current Web-host media against B without copying or changing data. |
| CloudBase functions/database | Tencent account B, existing CloudBase environment | Historical migration validation passed for index/detail mappings and function calls. | Run fresh, read-only health and representative lesson-index/detail checks. |
| Web app | Tencent account A, Seoul shared host | The Oct 21 console snapshot showed the host online. The Web site and its audio directory are separate locations on the same host. The host also serves unrelated workloads. | Record deployed source/build version; compare Web-host audio hashes to account B; test rollback and a static-hosting PoC before any move. Never rebuild or repurpose the shared host as part of this project. |
| WeChat Mini Program and cloud functions | Tencent account B; source is in this repository | Source and offline checks are present. Public-repository upload credentials and runner binding are not verified. | Verify AppID/environment privately, connect a public-repo-only upload path, then upload a development preview and inspect it in DevTools. |
| Historical WeChat upload runner | Self-hosted on the shared account A host per prior inventory | A target-repository registration and isolation from unrelated host workloads are not verified. | Decide whether to use GitHub-hosted upload or a dedicated isolated runner; do not register trusted upload jobs on a shared host until isolation is demonstrated. |
| Public-repository Tencent identity | Tencent OIDC | The old private-repository identity was validated historically. That authorization does not cover this public repository. | Create/verify a separate exact-subject read-only identity for the required private COS objects; use no static Tencent keys. |
| Agent provider and native CI | GitHub Actions / protected repository settings | Public workflow credentials and current-SHA mobile simulator/emulator evidence are not yet verified. | Review workflow permissions and prompts; prove a dry run, then a read-only Scout and reviewed draft Builder. Keep emulator/simulator evidence separate from physical-device tests. |

## Evidence freshness

Historical validation is evidence of the migration at that time, not proof that every current live resource remains unchanged. The Oct 17 migration report passed the account B data integrity and CloudBase checks. The Oct 21 Web-host console snapshot showed the shared server online, but did not establish its deployed commit or prove that its audio files still match account B.

Before changing any connection, refresh the relevant inventory and retain a sanitized evidence record. Public documentation must not contain host addresses, filesystem paths, internal URLs, course payloads, credentials, runner tokens, or raw device reports.

## Repository boundary

| Area | Canonical destination | Status |
| --- | --- | --- |
| Flutter Web/iOS/Android and WeChat source | This public repository | Source snapshot present; public CI verified |
| G4 checks and tests | This public repository | Offline tests pass on GitHub-hosted Actions |
| Native emulator/simulator tests | This public repository | Not yet verified in public Actions |
| Agent Scout/Builder implementation | This public repository | Public-repository credentials and end-to-end run not yet verified |
| Issues, PRs, decisions, open work | Public issues/PRs only after privacy review | Not fully reconciled; do not bulk-copy private discussions |
| Git history, releases, signed builds | Private archive or private artifact storage | Historical releases may include licensed lesson content |
| Course JSON, transcripts, audio | Existing authorized private Tencent storage | Exclude from Git, public Releases, and public Actions artifacts |
| Credentials, runner registration tokens, signing keys | Protected GitHub settings or host-side secret store | Re-enter/register securely; never commit values |

## Target identity and least privilege

The public repository target is `gehbfarr5/englishpod-trancy-player-public`, default branch `main`. Its Tencent OIDC subject is:

    repo:gehbfarr5@111337856/englishpod-trancy-player-public@1428251473:ref:refs/heads/main

The old private repository subject is not a fallback for the public repository. Keep course reads in a dedicated read-only role scoped to required private audio objects. A read role must not deploy to a Web host. If a cloud write is required, use a separate least-privilege identity or host-local deployment mechanism.

## Required sequence

1. Review and merge sanitized repository documentation and workflow changes.
2. Refresh account B inventory and read-only integrity checks; compare the existing Web-host audio copy against B.
3. Establish the public-repository OIDC trust and verify narrowly scoped reads without exposing lesson data to public Actions artifacts or logs.
4. Run a reversible Web static-hosting PoC while the current Web host remains available.
5. Choose an isolated Mini Program upload route; install the new-repository secret directly in protected settings and validate a development preview.
6. Verify Agent workflows, native CI, and current-SHA evidence.
7. Switch one connection at a time, verify live behavior, and prove rollback.
8. Disable old-repository triggers and confirm no active service depends on them.
9. Update the private repository landing page, preserve private-only history and licensed artifacts, then archive the old repository as the final acceptance step.

## Credential handling

Create secrets only after confirming the workflow that consumes them:

- `WECHAT_CI_PRIVATE_KEY_B64` for an approved Mini Program development upload.
- `DEEPSEEK_API_KEY` only after the public Agent workflow is reviewed and ready.
- Apple/Android signing secrets only if those workflows are deliberately restored.

Do not ask for secret values in issues, logs, or chat. The owner enters them directly in GitHub or the authenticated Tencent console.
