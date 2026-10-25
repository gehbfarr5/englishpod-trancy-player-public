# Mini Program test policy

Date: 2026-10-25 · current self-use phase

## Decision

Tencent MiniTest is an opt-in milestone check, not a per-change or per-preview requirement. It is run only when its device coverage can answer a specific compatibility question and the configured plan has been checked against the flows under review.

## Routine development

- Every relevant pull request runs credential-free type checks, unit tests, configuration/version checks, package auditing, and offline WeChat CI validation.
- A manual `upload` run uploads a development build only. A `preview` run generates a developer QR only. Neither starts MiniTest.
- A manual `cloud-test` run uploads the current main-branch commit and then runs MiniTest for the configured iOS/Android platforms. It requires both `UPLOAD_WECHAT_DEV_CODE` and the separate `RUN_MINITEST` confirmation.
- Do not run MiniTest for every UI adjustment, commit, or preview build.

## When to run MiniTest

Use it at a meaningful checkpoint when at least one of these is true:

1. A change affects platform-sensitive behavior such as background audio, playback lifecycle, progress restoration, share-entry cold starts, or compatibility-critical rendering.
2. The team is preparing to widen testing beyond the owner or to start a broader learner trial.
3. The cloud result can provide device coverage that is not available from the owner’s current devices.

Before submission, verify that the configured test plan includes the rebuilt route and the target actions. If coverage is unknown or absent, do not spend cloud quota on an aggregate result; use focused owner-device testing and improve the plan before the next cloud run.

## Result interpretation and quota handling

A cloud run is a PASS only when the task reaches the normal terminal status, the matching task has `success_rate = 1`, a report is available, and the report/case inventory covers the target route and actions. An aggregate success rate alone does not establish that the rebuilt player or a new share flow was tested.

If MiniTest rejects a submission because the weekly duration quota is insufficient, mark the cloud check `BLOCKED: quota` and record the provider’s requested and remaining duration. Do not classify that as a code failure, retry repeatedly in the same quota window, or block development when offline checks and the required device acceptance have passed. Retry only at a later milestone when quota is available and the coverage precondition still holds.

## Evidence recorded so far

- The 0.3.15 MiniTest task `196388` completed for iOS and Android with status `12` and aggregate success rate `1`; the sanitized summary does not list individual cases, so it is not proof of rebuilt-route coverage.
- The 0.3.16 task was rejected before task creation: the request required 2400 seconds while 1800 seconds remained for the week. Development-code upload and preceding verification had succeeded.
- The 0.3.17 preview generated successfully. Preview mode does not run MiniTest.

This policy is for the current self-use stage. Reassess the frequency and value of cloud testing before a wider learner trial; no production submission or release is implied.
