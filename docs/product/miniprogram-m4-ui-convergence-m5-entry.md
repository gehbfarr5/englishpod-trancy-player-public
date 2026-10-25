# Mini Program M4 UI convergence and M5 entry

Date: 2026-10-25 · candidate 0.3.17

## M4 owner acceptance

The owner reports that the 0.3.16 development build passed manual playback and transcript switching checks. This is owner-device evidence for that build. The configured MiniTest cloud task for 0.3.16 was rejected because the weekly duration quota was insufficient; it must not be described as a cloud PASS.

## Selective UI convergence

The rebuilt page keeps the learning hierarchy and familiar affordances that remain useful: a separate course library, a visible continue-learning card, a course title and level, Podcast/Dialogue/vocabulary tabs, readable speaker-labelled transcript rows, current-sentence highlight, an explicit return-to-current-sentence control, and a stable bottom playback dock.

The course list and player are separate page surfaces so the user is not asked to browse and study in one crowded screen. The existing page remains native WXML/WXSS and uses the repository's theme tokens. The view layer receives only changed playback fields; it does not receive audio objects or continuously resubmit the course list.

The design intentionally excludes the legacy page's visual dependencies on dual audio tracks, paired transcript viewports, precise animated scrolling, and decorative motion that could cause jumping or make reading compete with playback. The three content tabs never create or replace the single Podcast source.

## M5 share entry

- A learner can share the selected course from the player page.
- The shared path contains only the course ID and a share intent; it does not contain local progress or playback position.
- A recipient opens the course's Podcast at 00:00 in a paused state and starts it with an explicit play action.
- Opening a share link for the same course already active in the app does not reload or interrupt that session.
- Ordinary library and continue-listening entries retain their established resume and playback behavior.

## M5 acceptance still required

1. Test version 0.3.17 on Android WeChat and record Android device/model, OS, WeChat and base-library versions, app version, and commit SHA.
2. Open the Mini Program from a shared course card; verify the correct course, start-at-zero paused state, explicit play, and no mutation of the recipient's prior checkpoint before real playback advances.
3. From the recipient build, switch all three content views while playing and paused; tap a Podcast sentence; pause/resume; background and return; verify no duplicate audio source and no unexpected scroll jump.
4. Verify ordinary library entry and continue-listening behavior still match the existing playback contract.
5. Collect first-use feedback without coaching before considering a wider trial. A development/preview build may be restricted to authorized WeChat members, so successful self-sharing alone does not prove public sharing access.
6. MiniTest is optional at this self-use stage. Run it against the exact 0.3.17 SHA only at a meaningful compatibility checkpoint, after confirming that the case inventory covers the rebuilt route and share flow. If the weekly quota blocks submission, record `BLOCKED: quota`; this does not block the manual device acceptance. See the [Mini Program test policy](miniprogram-test-policy.md).

No production submission or public release is included in M5.
