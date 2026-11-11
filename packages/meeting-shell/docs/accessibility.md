# Accessibility

`@strevokit/shell` targets WCAG 2.2 AA. This page describes what the shell guarantees and what it doesn't cover yet.

The shell renders into the page's normal DOM, inside `<strevokit-meeting>`, rather than into a Shadow DOM. Assistive
technology, browser focus handling, and in-page search see it like the rest of your page.

## Keyboard

- Every control is a native button, select, or dialog element. Everything works with Tab, Shift+Tab, Enter, Space, and
  Escape, in visual order, with a visible focus ring (including the participants panel, presentation overlays, and
  Full screen / Exit full screen / Show controls).
- Device menus open from the arrow buttons next to the microphone and camera, with Enter, Space, or the Up and Down
  arrow keys. Up, Down, Home, and End move between devices; Enter or Space chooses one; Escape closes the menu and
  returns focus to its button. Where the browser can choose a speaker, a Speaker menu opens the same way.
- The participant list opens from **Participants** as a complementary region named **Participants**, not a dialog.
  Focus is not trapped. **Close participants** and Escape close it and return focus to the Participants button.
- While a shared screen is on stage, **Full screen** enters presentation. The same control becomes **Exit full screen**;
  focus stays on it when the name changes. **Show controls** (`aria-pressed`) reveals Microphone, Camera,
  Participants, Leave, and Share screen for a host. Enter and Space activate them. Escape closes the participants
  panel first (and returns focus to Participants); when the panel is already closed, Escape leaves presentation.
  When the meeting element is browser-fullscreen, the browser handles Escape and the shell follows `fullscreenchange`.
  Entering or leaving presentation announces through the polite live region without moving focus.
- The End meeting confirmation dialog opens from **End meeting** (for hosts). Initial focus is on **Cancel**. Tab moves
  between Cancel and End meeting. Escape or Cancel closes the dialog and returns focus to the End meeting button.

## Screen readers

- Icon-only controls have accessible names, and toggles expose their state (`aria-pressed`). The controls are grouped
  in a toolbar named **Meeting controls**.
- Changes are announced through a polite live region without moving focus: joining, your microphone and camera turning
  on or off, switching devices, other participants joining or leaving, device problems, full screen on and off, and the
  meeting ending.
- When the connection to the meeting is interrupted, a connection banner appears above the video tiles and its text is
  announced once. The text names whether the meeting connection or audio and video is recovering, without blaming a
  participant. It is announced again when that meaning changes (for example meeting-service recovery to audio and
  video interruption, or reconnecting to failed, or back), but not when meeting-service recovery only toggles the
  offline guidance. When the connection recovers, the banner disappears and "Reconnected" is announced. A short
  interruption that recovers within a second shows and announces nothing.
- Other problems during the meeting appear as a notice in the same place above the tiles, and are announced when they
  appear. The banner takes priority: a notice waits underneath it and is shown and announced once the banner clears.
- Neither the banner nor a notice moves focus, and the meeting controls stay usable while they are shown. A notice has
  a **Dismiss** button (named "Dismiss message"); if that button had focus, focus moves to the microphone toggle when
  the notice is dismissed.
- A camera or microphone problem is explained next to its toggle, which points to the message as its description.
  Each message has a **Dismiss** button (named "Dismiss camera message" or "Dismiss microphone message"); if that
  button had focus, focus moves to that device's toggle. Pressing the toggle again tries the device and brings the
  message back if the problem remains.
- Video tiles are named after the participant, show a "Microphone off" badge with hidden text when they are muted, and
  say in text when their connection is being restored.
- When you join, focus moves to the microphone toggle. When the meeting ends, focus moves to the final screen's
  heading. The shell only moves focus when it already has focus or nothing else on the page does, so it never pulls
  focus away from your own page.

## Visual

- Text has at least 4.5:1 contrast, and state indicators, focus rings, and control borders at least 3:1, in both the
  light and dark appearances, with the default colours.
- State is never shown by colour alone: muted and camera-off states also change the icon and the text. The connection
  banner and notices always pair a warning icon with text, in both the warning and the danger tone.
- Interactive controls are at least 44 by 44 CSS pixels (`--svk-target`), including Full screen, Exit full screen, Show
  controls, Close participants, and the critical meeting controls.
- Width adaptations use the meeting element's own width (container queries on `<strevokit-meeting>`), not the browser
  window. Down to a 320px wide element, the microphone, camera, participants, and leave controls stay visible without
  horizontal scrolling. Below 480px the text labels are hidden visually but keep their accessible names. Below 768px of
  meeting width the participants panel overlays the stage; at 768px and wider it docks beside the stage.
- Animations and transitions are turned off when the user prefers reduced motion, including presentation chrome
  reveal. Hover reveal during full screen does not rely on a long animation.

## How it's checked

- An accessibility lint for the element templates (`eslint-plugin-lit-a11y`, every recommended rule as an error) runs
  on the source on every change.
- Component tests run axe on every screen and check keyboard operation, focus return, live announcements, and the
  contrast of every colour pair in both appearances.
- Browser tests check keyboard-only use of the full meeting flow, the layout at 320, 768, and 1440 pixels wide, and that
  aggressive page styles don't change the shell's look.

## Known limits

- Captions, sign-language pinning, and a high-contrast appearance beyond light and dark are not available yet.
- Colours you set through the `--svk-*` variables are not checked; keep them within the contrast ratios above (see the
  [theming guide](./theming.md)).
- Page styles that use `!important` or ID selectors and match elements inside the shell can change its look, including
  focus rings and sizes.
- Automated checks can't replace testing with real assistive technology. Manual screen-reader testing across browsers
  is still in progress.

To report an accessibility problem, open an issue in the
[source repository](https://github.com/AgiliaIT/strevokit-shell/issues).
