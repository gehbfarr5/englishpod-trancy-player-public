# M1 evidence checkpoint — 2026-10-25

## Verified baseline

- Source: a476ce929e729f86e17c5bb47328f22fb2e2e22c, package 0.3.12.
- Development upload / OpenAPI / MiniTest: [run 40107566857](https://github.com/gehbfarr5/englishpod-trancy-player-public/actions/runs/40107566857).
- Downloaded sanitized artifact: task 196290, status PASS, taskStatus 12, successRate 1, reportAvailable true, platforms ios/android, testType 2, wxVersion 3.
- User confirmed manual testing passed. Device/system, individual steps and audio observations were not itemized; do not expand this confirmation into ten individually verified M1 cases.
- PRs #42–#46 fixed missing-config false success, development robot binding, initial task statuses and report-resource request parameters.

## Coverage boundary

The artifact proves the configured plan passed; it does not list case names, device models, assertions or observed sound. No Minium suite is checked into this repository. The existing e2e scenarios target the legacy dual-track player and are not evidence for the isolated M1 page.

M1-04 has pure coordinator/tap regression tests plus the user's general device confirmation. M1-01/02/03/06/07 require course entry, persistence and course navigation that the single-course experiment does not implement. M1-05/08/10 still need explicit background/lock-screen/interruption/long-audio observations. M1-09 needs device evidence for resource failures and rapid course switching. These remain NOT TESTED at per-case device level until an identified report or recorded observation supports them.

Do not mark all of M1 closed solely from this cloud summary. Obtain a sanitized case/device inventory from the configured plan (no report access URLs, tokens or raw course/account screenshots in the public repository). Cloud limitations on audible output must be recorded separately.

## Current lifecycle patch (0.3.13 candidate)

The experiment previously rendered on media callbacks while hidden, and late course loads could update a disposed page. The patch suppresses hidden audio renders, resamples on show, and ignores successful/failed async results after unload. It preserves the experiment's existing pause-on-exit behavior; this is not the future application-level session architecture.

Validation: TypeScript typecheck, configuration validation, 364 tests passed, including page-level hide/show and unload-during-load regressions. The local tsx CLI could not open its IPC socket; the identical test file list ran through `node --import tsx --test`. CI retains the standard npm test command. This candidate needs its own CI and device regression; 0.3.12's cloud PASS is not inherited.

## Next implementation boundary

M2 should introduce an app-level single-Podcast session with explicit event/course generations and one progress writer, independent of page mount and content selection. Keep the legacy storage intact. The development experiment is not a substitute for the final course player. Existing M1 evidence and the missing case-level inventory must remain visible during implementation.
