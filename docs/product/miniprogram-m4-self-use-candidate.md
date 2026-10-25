# M4 self-use candidate

2026-10-25 · candidate 0.3.16

## M3 exit evidence

M3 cloud run [40158787542](https://github.com/gehbfarr5/englishpod-trancy-player-public/actions/runs/40158787542) completed against commit `7d276e53ed2f871081664cc271b20c769ed748d2`: MiniTest PASS, task `196388`, status `12`, success rate `1`, report available, configured platforms iOS and Android. This is an aggregate result for the configured plan. Its sanitized summary does not identify individual cases or confirm that the plan navigated to the rebuilt M3 route.

## M4 changes

- Normal course selection and continue listening now always open `pages/rebuildPlayer/index` in development, trial, and release environments.
- The old player route remains registered as a code-level rollback option, but the library no longer routes to it or subscribes to its `playbackSession`. The library observes the app-owned Podcast runtime instead, so it cannot initialize a second legacy audio session.
- The development-only rebuild entry was removed from the catalog; the rebuilt course player is the product entry.
- The release-only guard was removed from the rebuilt player. A visible retry action reopens the current course (or first course if none was selected) after a load/playback failure.
- No migration or deletion of existing progress records is performed. No production submission or publication is part of M4.

## Candidate acceptance

Before calling the self-use candidate complete, run the exact 0.3.16 SHA through the existing version, packaging, GitHub CI, development upload, and MiniTest result gates. Verify the cloud summary SHA/version, terminal status `12`, success rate `1`, and report availability.

Aggregate MiniTest PASS does not by itself prove audible output or route-specific coverage. Confirm the configured plan's case inventory. If it does not cover the rebuilt route, perform these owner-device checks on at least the current iPhone WeChat build: open a course from the library, continue the saved course, switch PB/DG/vocabulary, tap a PB sentence, pause/resume, move to another course, navigate away and return, and exercise one failed/retried content load. Actual voice output, lock-screen continuity, system audio interruptions, and long background playback remain manual evidence unless the report explicitly observes them.

## Remaining before broader trial

M5 still requires Android WeChat real-device testing, a share-to-course entry flow, and unassisted first-use feedback. A successful self-use candidate is not a public release decision.
