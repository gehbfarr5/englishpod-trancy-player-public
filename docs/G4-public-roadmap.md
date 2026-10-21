# G4 execution roadmap (public-safe)

This public mirror carries source-level automation for the G4 target. A workflow pass is not a substitute for device or production measurements.

## Automated work

- Run Flutter, mini-program, Python, and web contract checks on GitHub-hosted runners.
- Validate offline first-content and catalog-scale benchmark inputs.
- Keep regression evidence machine-readable and sanitized; do not upload raw device logs or credentials.
- Restrict deployment and WeChat upload jobs to trusted default-branch runs and approved environments.

## Acceptance still requires

- Real device runs and sanitized evidence from the tester.
- Measured first-content latency and catalog-scale measurements.
- Two issue-backed improvement cycles with before/after evidence.
- Successful GitHub Actions runs on the public repository.

## Resource configuration

Tencent Cloud and WeChat credentials belong in repository or environment secrets, never in Git. Public workflows must not expose secrets to fork pull requests or run untrusted code on self-hosted runners.

Lesson transcripts and audio remain outside this repository. Confirm content distribution rights before publishing or redistributing lesson material.
