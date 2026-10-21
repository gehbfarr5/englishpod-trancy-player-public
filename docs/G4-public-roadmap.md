# G4 execution roadmap (public-safe)

This public repository carries source-level automation for the G4 target. A workflow pass is not a substitute for physical-device or production measurements.

## Automated work

- Run Flutter, Mini Program, Python, and web contract checks on GitHub-hosted runners.
- Validate offline first-content and catalog-scale benchmark inputs.
- Keep regression evidence machine-readable and sanitized; do not upload raw device logs, licensed content, or credentials.
- Restrict deployment and WeChat upload jobs to trusted default-branch runs and approved environments.
- Run Android Emulator and iOS Simulator regression with isolated synthetic audio fixtures.

## Current public evidence (2026-10-22)

- G4 offline checks and Mini Program source checks pass on public main.
- Flutter tests and a release Web build pass on the change PR; post-merge main verification is queued. The build is not a Tencent deployment.
- The first Android/iOS simulator attempt exposed missing native wrapper projects before application tests. The workflow now generates temporary unsigned wrappers on hosted runners; the retry is running. No native pass is claimed yet.
- No current-SHA physical-device evidence, live Web deployment verification, or production measurements are recorded here.

## Acceptance still requires

- Successful, machine-readable native simulator/emulator runs on the current public SHA.
- Real device runs and sanitized evidence from the tester.
- Measured first-content latency and catalog-scale measurements.
- Two issue-backed improvement cycles with before/after evidence.
- Verified Web deployment, course-access behavior, and rollback where G4 acceptance depends on the live product.

## Resource configuration

Tencent Cloud and WeChat credentials belong in protected repository or environment settings, never in Git. Public workflows must not expose secrets to fork pull requests or run untrusted code on self-hosted runners.

Lesson transcripts and audio remain outside this repository. Confirm content distribution rights before publishing or redistributing lesson material.
