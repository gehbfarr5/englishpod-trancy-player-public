# M3 content and course catalog

2026-10-25 · candidate 0.3.15

## Scope

M3 builds on the M2 app-owned Podcast session. The rebuilt player now has a searchable course catalog (lesson ID, title, and level), bounded batches of 30 results, the PB/DG/vocabulary content views, and PB transcript replay. It does not add a Dialogue audio path.

Tapping a PB sentence seeks the existing Podcast source to that sentence start. It preserves the current play/pause state and does not change course, complete the lesson, or create another media session. The active sentence is highlighted from the actual PB position. Automatic following is intentionally explicit: the learner can use “Return to current sentence” to move the transcript viewport; ordinary reading and scrolling do not make the view jump. Dialogue remains a reading-only view and has no playback position mapping.

## Implementation notes

- The course list is filtered in memory from the cached course index; it does not issue a cloud request for every keystroke.
- Only 30 catalog rows are rendered initially; “Show more” adds another 30 to limit page data and native view work.
- PB segments render with the existing source segment IDs and timestamps. Chapter markers are styled as section headings; tapping a timed segment delegates to `PodcastSession.seek`.
- The app-level runtime and its single `BackgroundAudioManager` remain independent of the content view and page lifecycle.
- The selected course and active PB segment are derived from the current runtime, not a second player or a wall-clock estimate.

## Validation

TypeScript, configuration, package-version alignment, and the complete Mini Program test suite must pass for this candidate. The page/runtime regression covers title search, bounded course results, current sentence tracking, tap-to-seek while preserving playback, view changes without media commands, and page reentry.

Cloud MiniTest must be run against the exact 0.3.15 main-branch SHA. Its aggregate PASS is evidence only for the configured plan; unless its case inventory confirms the rebuilt route and transcript actions, sentence replay and reading behavior still need a brief owner-device check.

## Remaining M3/M4 acceptance

- Verify search results against the real 335-course index, including empty and broad queries.
- Exercise PB/DG/word view switching and PB sentence replay on the target WeChat client while listening and while paused.
- Measure long transcript rendering and scroll behavior on representative long lessons; set performance thresholds from measurements.
- Verify the configured MiniTest plan's exact M3 route coverage before attributing its device result to these interactions.
- M4 owns replacing the legacy production route after the development candidate is accepted, recovery/weak-network validation, and release traceability. No production publication is part of this candidate.
