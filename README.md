# EnglishPod Trancy Player — public continuation

This repository is the sanitized public continuation of the EnglishPod Trancy Player project. It is being prepared to run source-level CI and G4 automation on GitHub-hosted runners.

## Scope

- Flutter Web/iOS/Android player source
- WeChat Mini Program source
- G4 benchmark and regression tooling
- Sanitized CI and deployment workflows for the existing Tencent Cloud and WeChat environments

Course transcripts, lesson JSON, audio assets, signing files, account migration notes, raw device evidence, and private infrastructure configuration are intentionally excluded. Deployment credentials must be configured as repository or environment secrets; no credential values belong in the source tree.

## Deployment safety

- CI for pull requests uses GitHub-hosted runners and read-only repository permissions.
- Tencent Cloud deployments and WeChat uploads are restricted to approved runs from the protected default branch.
- Self-hosted runners must not execute untrusted pull-request code.
- Course content is expected to remain in its existing authorized storage; this repository does not grant redistribution rights.

## Migration status

This repository is a private staging copy until the source, license, workflow, and secret-handling checks are complete. G4 work can be staged here while that audit proceeds.
