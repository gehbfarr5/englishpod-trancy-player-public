# EnglishPod Trancy Player — public continuation

This is the sanitized public continuation of the EnglishPod Trancy Player project. It contains the application source, Mini Program source, and G4 automation tooling for continued development.

## Scope

- Flutter Web/iOS/Android player source
- WeChat Mini Program source
- G4 benchmark and regression tooling
- Sanitized CI and deployment workflow definitions for the existing Tencent Cloud and WeChat environments

Course transcripts, lesson JSON, audio assets, signing files, account migration notes, raw device evidence, and private infrastructure configuration are intentionally excluded. Deployment credentials must be configured as repository or environment secrets; no credential values belong in the source tree.

## Deployment safety

- Pull request CI is designed to use GitHub-hosted runners and read-only repository permissions.
- Tencent Cloud deployments and WeChat uploads must be limited to approved runs from the default branch.
- Self-hosted runners must not execute untrusted pull request code.
- Course content remains in its existing authorized storage; this repository does not grant redistribution rights.

## Migration status

The repository is public. Source has been staged, but Tencent Cloud web deployment, course-data retrieval, WeChat upload credentials, and runner setup are not yet connected or verified. The latest CI jobs failed before a runner started, so automated checks have not yet run on GitHub.
