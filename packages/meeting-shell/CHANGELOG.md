# Changelog

All notable changes to `@strevokit/shell` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[semantic versioning](https://semver.org/). Before 1.0.0, breaking changes bump the minor version. Each release names
the meeting SDK version built into it, and lists changes to the documented `--svk-*` variables.

## [Unreleased]

No changes to the documented `--svk-*` variables.

### Changed

- One person and two people fill the stage; three or more stay a wrapping gallery that scrolls only inside the stage.
- While anyone is sharing a screen, that share alone fills the stage (no camera strip beneath it). Stopping the share
  restores the gallery.
- The participants list is a side panel that overlays the stage below 768px of meeting width and docks beside the stage
  at 768px and wider.
- **Full screen** during a share hides nonessential chrome so the share can fill the display. If the display cannot be
  filled, the same chrome-hidden layout runs inside the meeting with a plain-language notice. **Exit full screen** and
  **Show controls** stay reachable; leaving restores the participants panel to how it was on entry.

## [0.5.0]

Bundles `@strevokit/meeting-sdk` 0.8.0; the only runtime dependency is still Lit 3 (`lit` `^3.3.0`).
No changes to the documented `--svk-*` variables.

### Changed

- The in-meeting device menu updates the checked camera or microphone when the switch settles. A failed switch leaves
  the previous device checked.
- A speaker control appears only where the browser can choose where meeting audio plays. It uses the same menu as the
  camera and microphone.

## [0.4.1]

Bundles `@strevokit/meeting-sdk` 0.7.0; the only runtime dependency is still Lit 3 (`lit` `^3.3.0`).
No changes to the documented `--svk-*` variables.

### Changed

- Connection banner copy names the affected connection without blaming a participant:
  meeting-service recovery says "Meeting connection lost — reconnecting…", offline adds
  "Check your internet connection.", and audio/video interruption says
  "Audio and video interrupted — reconnecting…".
- Distinct degraded banner variants (for example meeting-service recovery vs audio/video
  interruption) are announced again for screen readers; meeting-service ↔ offline still stays quiet.
- Remote tile and participants-list interrupted status says "Reconnecting…" instead of
  "Connection interrupted".

## [0.4.0]

Bundles `@strevokit/meeting-sdk` 0.7.0; the only runtime dependency is still Lit 3 (`lit` `^3.3.0`).
No changes to the documented `--svk-*` variables.

### Added

- Optional `getJoinToken` and `reconnectWindowMs` on mount / element settings, forwarded to the meeting engine.
- Local meeting-service recovery drives the existing connection banner (`meetingServiceStatus`) so mid-call drops
  show "Connection lost — reconnecting…" while the session stays in-meeting.

## [0.3.1]

Bundles `@strevokit/meeting-sdk` 0.6.0; the only runtime dependency is still Lit 3 (`lit` `^3.3.0`).
No changes to the documented `--svk-*` variables.

### Fixed

- Solo participant camera tile no longer overflows the stage height on short/wide host containers; the tile stays
  16:9, centers in the stage, and narrows when needed so the shell does not show an unnecessary scrollbar.

### Documentation

- Backend API guide covering `POST /v1/meetings`, `POST /v1/meetings/{public_id}/participants`,
  `POST /v1/meetings/{public_id}/join-token`, and related embed-origin / get / end routes; backend example expanded
  beyond join-token-only.

## [0.3.0]

Bundles `@strevokit/meeting-sdk` 0.6.0; the only runtime dependency is still Lit 3 (`lit` `^3.3.0`).
No changes to the documented `--svk-*` variables.

### Added

- Spotlight layout while a screen share is active: the **Shared screen** tile fills the stage as the meeting focus
  and camera tiles sit in a strip below it; when no share is active, the tiles render in the previous equal-sized
  grid.

## [0.2.0]

Bundles `@strevokit/meeting-sdk` ^0.6.0; the only runtime dependency is still Lit 3 (`lit` `^3.3.0`).
No changes to the documented `--svk-*` variables.

### Added

- **Share screen** control for hosts: toggle in the control bar (`aria-pressed`, keyboard), live-region
  announcements ("Screen sharing on" / "Screen sharing off"), and a non-mirrored **Shared screen** tile for self
  and remote participants when a share stream is present. Non-hosts do not see the control. Share start failures
  (cancelled, permission denied, unavailable, not permitted) show as dismissible in-meeting notices.
- End meeting control: hosts can end the meeting for all participants via an **End meeting** danger button in the control bar. Activating it opens a confirmation dialog ("End the meeting for everyone?"). On confirmation, the meeting ends for everyone and displays the ended screen.
- Embedder option: `hideEndMeeting` on `MountOptions` and the `<strevokit-meeting>` element property/attribute (`hide-end-meeting`), allowing embedders to hide the End meeting button from hosts.
- A connection banner above the video tiles when the meeting connection is interrupted, the browser goes offline, or
  the connection can't be restored. Interruptions that recover within a second show nothing. The meeting controls stay
  usable, and "Reconnected" is announced when the connection recovers.
- In-meeting notices, in the same place, for other problems during the meeting (for example, too many attempts or the
  service being briefly unavailable), with a **Dismiss** button. Every error code has plain-language copy;
  engine error text is never shown.
- A camera or microphone that stops during the meeting is now explained as a revoked permission when the browser
  reports one, and as a disconnected device otherwise.
- Camera and microphone messages have a **Dismiss** button (named "Dismiss camera message" or "Dismiss microphone
  message"). A dismissed message stays hidden for the rest of the page visit while the same problem remains; pressing
  that device's toggle tries it again and shows the message again if the problem is still there.
- Camera and microphone problems recover on their own when the browser reports that the site permission or the
  connected devices changed. Before joining, the preview starts again; in the meeting, the message clears and the
  toggle becomes usable, but the device is only turned on when the participant presses it.
- Diagnostics entries on `logger`: "meeting shell showed a failure" (`warn`) once per failure shown to the
  participant, and "meeting shell connection recovered" (`info`), with enumerable fields only. See
  [Shell diagnostics entries](./docs/api-reference.md#shell-diagnostics-entries).

### Changed

Some shown text changed. If your own tests assert these strings, update them:

- Camera or microphone permission denied: "… Allow camera access in your browser's site settings, then try again." is
  now "… Allow camera access from the icon next to the address bar and in your system settings, then try again." (and
  the same for the microphone).
- Device disconnected: "Your camera was disconnected." is now "Your camera was disconnected. Reconnect it, then try
  again." (and the same for the microphone).
- A join interrupted before it finished (`join_cancelled`): "Something went wrong joining the meeting. Try again.",
  without a retry, is now "Joining was interrupted. Try again." with a **Try again** button.
- Already in the meeting elsewhere when joining (`session_replaced`): "Something went wrong joining the meeting. Try
  again." is now "You're already in this meeting in another tab or on another device."
- Join failures that can't be retried: "Something went wrong joining the meeting. Try again." is now "Something went
  wrong joining the meeting. Reload the page to try again."

## [0.1.0]

First release. Bundles `@strevokit/meeting-sdk` 0.4.0; the only runtime dependency is Lit 3 (`lit` `^3.3.0`).

### Added

- `<strevokit-meeting>`: a framework-neutral custom element with the complete meeting UI: a pre-join screen (camera
  preview, microphone level, device choice, camera and microphone toggles), the meeting view (video tiles, controls,
  participant list, device menus), and a final screen for every way a meeting can end.
- `mount(target, options)`, returning a handle with `element`, `on()`, `leave()`, and `destroy()`.
- The element's `appearance` and `realtime-url` attributes, the `token` and `logger` properties, the `leave()` method,
  and the `svk-joined` and `svk-closed` events, with close reasons `left`, `meeting_ended`, `session_replaced`,
  `connection_lost`, `join_failed`, and `error`.
- A CDN build, `dist/strevokit-shell.min.js`, that sets the `StrevokitShell` global (`mount`,
  `StrevokitMeetingElement`, `version`) for use with a plain `<script>` tag.
- Light, dark, and system appearances, and 19 documented theme variables: `--svk-surface`, `--svk-surface-raised`,
  `--svk-text`, `--svk-text-muted`, `--svk-border`, `--svk-focus`, `--svk-danger`, `--svk-danger-text`, `--svk-on`,
  `--svk-off`, `--svk-warning`, `--svk-accent`, `--svk-accent-text`, `--svk-tile`, `--svk-tile-text`, `--svk-radius`,
  `--svk-gap`, `--svk-target`, and `--svk-font`.
- Styles that apply only inside the element and keep their look under common page styles, without `!important`.
- Keyboard operation, screen-reader announcements, and WCAG AA contrast in both appearances.
- The last chosen camera and microphone are remembered in the browser and preselected when still available.
- Safe to import during server rendering: the element is defined in browsers only, and loading the package twice
  doesn't redefine it.

### Size

Measured gzipped (level 9) at release, each including the 2.5 KB stylesheet:

- Module build (`dist/index.js` with the meeting SDK, without `lit`): 28.8 KB, against a 48 KB budget.
- CDN build (`dist/strevokit-shell.min.js`, everything included): 35.6 KB, against a 56 KB budget.
