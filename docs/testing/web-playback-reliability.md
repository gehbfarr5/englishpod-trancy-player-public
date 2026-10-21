# Web playback reliability

This note describes the app's bounded playback and progress behavior. It is not evidence of a live-host, licensed-catalog, or physical-device acceptance test.

## Progress persistence

- Each progress snapshot is encoded when the save is requested.
- Writes are serialized in request order, so a slower earlier write cannot overwrite a newer snapshot.
- A failed write is recorded as unsaved and does not poison the queue. A later full snapshot can recover the stored state.
- This does not guarantee persistence when browser storage is disabled, cleared, full, or unavailable.

## Audio loading

- A single load attempt is bounded by a 20-second timeout.
- Transient load failures receive at most three total attempts, with 500 ms and 1,000 ms backoff before attempts two and three.
- Recognized missing, undecodable, or unsupported assets are treated as permanent and are not retried.
- A timeout or retry does not establish that the production audio host or full course catalog is healthy.

## Browser autoplay

Browsers may refuse playback until the user interacts with the page. That expected refusal is caught and the player remains paused; the user can start playback with the play control. Other play failures are also contained so they do not become uncaught asynchronous errors.

## Verification limits

The focused unit tests cover failure classification. Public CI and simulator checks exercise synthetic assets. They do not prove audible output, live audio availability, licensed-catalog integrity, background playback, or behavior on a physical iPhone or Android device.
