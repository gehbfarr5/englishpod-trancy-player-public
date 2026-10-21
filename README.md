# EnglishPod Trancy Player — public continuation

This is the sanitized public continuation of the EnglishPod Trancy Player project. It is the intended canonical source for maintained application code and automation.

## Scope

- Flutter Web/iOS/Android player source
- WeChat Mini Program source
- G4 benchmark and regression tooling
- Sanitized CI and deployment workflow definitions

Course transcripts, lesson JSON, audio assets, signing files, account migration notes, raw device evidence, and private infrastructure configuration are intentionally excluded. Deployment credentials belong only in protected repository or environment settings.

## Deployment safety

- Pull request CI uses GitHub-hosted runners and read-only repository permissions.
- The WeChat development-upload workflow uses a GitHub-hosted runner; the credentialed upload remains manually gated.
- Tencent Cloud deployments and WeChat uploads must be limited to trusted default-branch runs and approved environments.
- Self-hosted runners must not execute untrusted pull request code.
- Course content remains in its existing authorized storage; this repository does not grant redistribution rights.

## Migration status (2026-10-22)

Public main CI passes for G4 offline checks and Mini Program source validation. Flutter tests and a release Web build were added and passed their PR checks; the post-merge main run is queued. The first Android/iOS simulator attempt exposed that the sanitized source has no native platform wrappers. The workflow now generates disposable unsigned wrappers on hosted runners, and the retry is running; no native pass is claimed yet. The Tencent OIDC trust now targets public main. A protected manual-only role-probe workflow is merged, but the exchange has not run because its repository variables are not yet verified; authorized COS reads are also unverified.

The live Web deployment, CloudBase end-to-end health, WeChat development upload/DevTools preview, and public Agent Scout/Builder are not yet verified. Keep the private repository as the rollback record until the public connections and service cutover are proven. See [the resource register](docs/public-repository-resource-register.md) and [the cutover checklist](docs/tencent-cloud-cutover.md).
