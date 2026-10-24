# M2 single-Podcast implementation candidate

2026-10-25 · candidate 0.3.14

## Implementation

Development/trial builds expose **Open rebuilt Podcast player** in the library. This enters `pages/rebuildPlayer/index`; it is a separate implementation, not the legacy dual-track player. Production is unchanged pending final replacement in M3/M4. Do not open the legacy player first: BackgroundAudioManager is global, so the rebuilt runtime refuses an already occupied source rather than taking it over.

`PodcastSession` owns course request generations, latest play/pause intent, entry policy, manual course boundaries, natural-end wraparound, and progress writes through the existing ProgressJournal. It offers no Dialogue audio interface. Content tabs only update page data. The runtime singleton survives page unload; pages detach observers. Cold runtime creation does not play; explicit course/continue actions do. Loading new sources uses startTime and ready-time seek. An unready source errors after 30 seconds and can be retried. All progress samples come from BackgroundAudioManager.currentTime/duration, including a 3-second checkpoint during active playback; elapsed wall time is never used as playback position.

Completion and resume position remain separate. Seek alone does not complete or auto-advance. Loading, stale course responses and stale generation events cannot write the next course. Storage retains the existing schema and records; no data is deleted. The current module-scoped singleton is the application owner and is not a page-owned audio instance.

## Automated validation

Typecheck and configuration validation passed. All 373 tests passed, including eight session regressions and an adapter/page integration regression with a simulated WeChat manager. Tests cover overlapping A/B/C requests, pause while loading, old callbacks, normal completion and wraparound, seek-to-end exclusion, saved resume positions, completed-course entry, system pause/resume, failed-request retry, cold silence, PB-only source resolution, view switching without audio commands, page unload continuity and reentry without reload.

These are deterministic code tests, not device audio observations. CI must run against the candidate head; cloud device results must identify this candidate SHA and 0.3.14. Existing 0.3.13 task 196304 cannot be inherited.

## Device acceptance boundary

The configured MiniTest plan's aggregated result is only evidence for its own selected cases. Its case inventory is not present in the repository; no assertion here claims it navigates the rebuilt entry. Confirm that the plan exercises `pages/rebuildPlayer/index` before calling M2 device acceptance complete. If it does not, update the plan using the authorized console/local Agent. Do not publish raw reports or tokens.

Only when cloud evidence cannot cover actual sound, use a short owner-device check: cold launch → rebuilt entry → choose course → switch Podcast/Dialogue/word views while listening → pause, next course, resume → leave/reenter page → background/lock and return → restart and continue. Record actual steps/device/build; each must retain one audio source and correct real position. Natural-end auto-next needs a real end event, not dragging the slider to the end.

M3 still owns refined transcript interaction, performance work and the final replacement of the legacy product entry. This candidate is the integrated M2 development implementation, not a declaration that all rebuilding milestones are complete.
