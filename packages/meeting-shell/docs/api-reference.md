# API reference

`@strevokit/shell` exports one function, one class, and ten types. It also defines the `<strevokit-meeting>` element and,
in the CDN build, the `StrevokitShell` global. Anything not listed here is internal and can't be imported: the
package's `exports` map only allows `@strevokit/shell` and `@strevokit/shell/styles.css`.

```ts
import {
  mount,
  StrevokitMeetingElement,
  type MountOptions,
  type ShellHandle,
  type ShellHandleEventMap,
  type MeetingShellAppearance,
  type MeetingShellJoinedEvent,
  type MeetingShellClosedEvent,
  type MeetingShellCloseReason,
  type MeetingShellEventMap,
  type MeetingLogger,
  type ParticipantRole,
} from "@strevokit/shell";
import "@strevokit/shell/styles.css";
```

Importing the package defines `<strevokit-meeting>`, once, and only in a browser. Importing it during server rendering
doesn't throw and defines nothing; the element starts when the page loads in the browser. Loading the package twice
(for example the module and the CDN script) doesn't redefine the element.

## What the shell shows

1. **Pre-join screen.** A camera preview, a microphone level meter, camera and microphone choices, on/off toggles, and
   a **Join meeting** button. Nothing is sent to the meeting until the user joins.
2. **Meeting.** Video tiles for everyone, the control bar (microphone, camera, device menus, a speaker menu where the
   browser can choose where meeting audio plays, participants, leave), and the participant list. The speaker menu
   works like the camera and microphone menus.
3. **Final screen.** A short message explaining why the meeting ended. `svk-closed` fires (and `onClosed` is called)
   when it appears.

## `mount(target, options)`

```ts
function mount(target: string | HTMLElement, options: MountOptions): ShellHandle;
```

Creates a `<strevokit-meeting>` element, configures it from `options`, appends it to `target`, and returns a
`ShellHandle`. `target` is a CSS selector or an element; the shell is appended after any existing content.

It throws a `TypeError` synchronously, and creates nothing, when:

| Problem | Message |
|---|---|
| `target` is a selector that matches nothing | `StrevokitShell.mount: no element matches <selector>` |
| `target` is neither a selector nor an element | `StrevokitShell.mount: target must be a selector or an element` |
| `options.token` is missing, empty, or not a string | `StrevokitShell.mount: token is required` |

## `MountOptions`

| Option | Type | Required | Description |
|---|---|---|---|
| `token` | `string` | yes | Join token minted by your backend for this participant. Kept in memory only. |
| `realtimeUrl` | `string` | for now | Your Strevokit realtime endpoint, for example `wss://realtime.example.com`. Until Strevokit publishes a default endpoint, the shell stays idle without one. |
| `appearance` | `MeetingShellAppearance` | no | Colour appearance. Default `"system"`. |
| `onJoined` | `(event: MeetingShellJoinedEvent) => void` | no | Called once each time the participant enters the meeting. |
| `onClosed` | `(event: MeetingShellClosedEvent) => void` | no | Called exactly once when the final screen appears. Not called after `destroy()`. |
| `logger` | `MeetingLogger` | no | Diagnostics sink for the meeting engine and the shell's own [failure entries](#shell-diagnostics-entries). It never receives the join token. |
| `hideEndMeeting` | `boolean` | no | When `true`, hides the "End meeting" button from hosts. Default `false`. |
| `getJoinToken` | `() => Promise<string>` | no | Called when the meeting needs a fresh join token to restore a lost connection and the token in memory can't be used. Resolve with a token your backend issued for the same participant; reject to give up. Kept in memory only and never logged. |
| `reconnectWindowMs` | `number` | no | How long, in milliseconds, to keep trying to restore a lost connection. Default `120000`; values outside `1000`–`600000` are clamped. |

## `ShellHandle`

| Member | Type | Description |
|---|---|---|
| `element` | `StrevokitMeetingElement` | The `<strevokit-meeting>` element that was created. You can set its properties directly. |
| `on(type, listener)` | `(type: "joined" \| "closed", listener) => () => void` | Adds a listener for `"joined"` or `"closed"` (see `ShellHandleEventMap`). Returns a function that removes it. |
| `leave()` | `() => Promise<void>` | Leaves the meeting and resolves when the final screen is shown. Resolves at once when not in a meeting or after `destroy()`. |
| `destroy()` | `() => void` | Removes the element: leaves the meeting, releases the camera and microphone, and stops every callback and listener. Safe to call more than once. |

## `ShellHandleEventMap`

The events `ShellHandle.on()` accepts. They mirror the element's events.

| Event | Payload | Mirrors |
|---|---|---|
| `"joined"` | `MeetingShellJoinedEvent` | `svk-joined` |
| `"closed"` | `MeetingShellClosedEvent` | `svk-closed` |

## `StrevokitMeetingElement` (`<strevokit-meeting>`)

The class behind `<strevokit-meeting>`. Create the element in markup, with `document.createElement`, or with `mount()`.

### Attributes and properties

| Attribute | Property | Type | Default | Description |
|---|---|---|---|---|
| `appearance` | `appearance` | `MeetingShellAppearance` | `"system"` | Colour appearance. Reflected to the attribute. Unknown values fall back to `"system"`. |
| `realtime-url` | `realtimeUrl` | `string \| null` | `null` | Realtime endpoint. Not secret, so an attribute is fine. |
| — | `token` | `string \| null` | `null` | Join token. **Property only**: a `token` attribute is ignored. Never written to an attribute, logged, or put in events. |
| — | `logger` | `MeetingLogger \| null` | `null` | Diagnostics sink for the meeting engine and the shell's own [failure entries](#shell-diagnostics-entries). It never receives the token. |
| — | `getJoinToken` | `(() => Promise<string>) \| null` | `null` | Fresh-token callback used to restore a lost connection. **Property only.** Read when the meeting session starts. Never logged. |
| `reconnect-window-ms` | `reconnectWindowMs` | `number \| null` | `null` | How long, in milliseconds, to keep trying to restore a lost connection. Read when the meeting session starts. |
| `hide-end-meeting` | `hideEndMeeting` | `boolean` | `false` | When `true`, hides the "End meeting" button from hosts. Reflected to the attribute. |

The element also sets a `data-svk-appearance` attribute on itself for the stylesheet. It is not an input.

Properties set before the element is defined (for example before the script loads) are kept.

### Method

| Method | Description |
|---|---|
| `leave()` | `() => Promise<void>`. Leaves the meeting when in one and resolves when the final screen is shown; otherwise resolves immediately. |

### Events

Both events bubble. Their types are in `MeetingShellEventMap`, so `addEventListener` is typed.

| Event | Detail | When |
|---|---|---|
| `svk-joined` | `MeetingShellJoinedEvent` | Once each time the participant enters the meeting. |
| `svk-closed` | `MeetingShellClosedEvent` | Exactly once when the final screen appears. Not fired after the element is removed. |

```ts
const meeting = document.querySelector("strevokit-meeting");
meeting?.addEventListener("svk-closed", (event) => console.log(event.detail.reason));
```

### Lifecycle

- The element stays idle (renders nothing and requests nothing) until it is in the page and has both a `token` and a
  `realtimeUrl`.
- Each configuration creates one meeting connection. Removing the element leaves the meeting, stops the camera and
  microphone, and fires no events afterwards. Moving the element within the page in one step keeps the meeting.
- Setting a different `token` or `realtimeUrl` starts a new meeting from the pre-join screen.
- The element fills its container (`width: 100%; height: 100%`, at least 360px tall when the container has no height).
  It never uses fixed positioning, and its menus and popups stay inside it.

## `MeetingShellAppearance`

`"light" | "dark" | "system"`. With `"system"` the shell follows the browser's `prefers-color-scheme` setting. Both
appearances meet WCAG AA contrast with the default colours.

## `MeetingShellJoinedEvent`

| Field | Type | Description |
|---|---|---|
| `role` | `ParticipantRole` | `"host"` or `"participant"`, as set by your backend in the join token. |

## `MeetingShellClosedEvent`

| Field | Type | Description |
|---|---|---|
| `reason` | `MeetingShellCloseReason` | Why the meeting ended for this participant. |

## `MeetingShellCloseReason`

| Reason | When | Final screen |
|---|---|---|
| `"left"` | The user selected **Leave**, or you called `leave()`. | You left the meeting |
| `"meeting_ended"` | The host or the platform ended the meeting. | The meeting has ended. |
| `"session_replaced"` | The same participant joined from another tab or device. | You joined from another tab |
| `"connection_lost"` | The connection dropped and could not be restored. | Connection lost |
| `"join_failed"` | The join was refused or failed in a way retrying can't fix, for example an expired token. | Unable to join this meeting, with the reason |
| `"error"` | Any other unexpected failure. | Something went wrong |

Join failures that can succeed on retry (a network problem, a timeout) stay on the pre-join screen with a **Try again**
button and don't fire `svk-closed`.

## `MeetingShellEventMap`

Maps the element's event names to their types: `"svk-joined"` to `CustomEvent<MeetingShellJoinedEvent>` and
`"svk-closed"` to `CustomEvent<MeetingShellClosedEvent>`. The package also adds `"strevokit-meeting"` to TypeScript's
`HTMLElementTagNameMap`, so `document.createElement("strevokit-meeting")` and `querySelector("strevokit-meeting")`
return a `StrevokitMeetingElement`.

## `MeetingLogger` and `ParticipantRole`

The meeting SDK's logger interface (optional `debug`, `info`, `warn`, and `error` methods that take a message and
structured fields) and the participant role type (`"host" | "participant"`). The SDK is built into the shell, so you
don't need to install it for these types.

### Shell diagnostics entries

Besides what the meeting engine logs, the shell writes one entry to `logger` each time it shows a failure to the
participant, so you can match a support report to what they saw. With no `logger` set, nothing is logged, and the shell
never writes to the browser console.

```ts
logger.warn?.("meeting shell showed a failure", fields);
logger.info?.("meeting shell connection recovered", fields);
```

| Field | Present | Values |
|---|---|---|
| `surface` | always | `device` (a camera or microphone message), `join` (the pre-join alert), `banner` (the connection banner), `notice` (an in-meeting notice), `final` (the final screen) |
| `phase` | always | `prejoin`, `joining`, `in_meeting`, `final` |
| `code` | always, except on `final` entries for a reason without a code and on the recovery entry | a meeting error code such as `permission_denied`, `device_not_found`, `device_unavailable`, `unsupported_environment`, `rate_limited`, or `media_connection_failed`; or one of the shell's own codes: `device_disconnected`, `media_interrupted`, `browser_offline`; or `unknown` |
| `kind` | `device` entries | `camera`, `microphone` |
| `retry` | `device` and `join` entries | whether a retry button was offered |
| `reason` | `final` entries | `meeting_ended`, `session_replaced`, `connection_lost`, `join_failed`, `error` |
| `interruptedMs` | the recovery entry | whole milliseconds from the banner appearing to it clearing |

- One entry per failure when it becomes visible. A message that stays on screen writes nothing more until it is cleared
  and shown again. A repeat of the current notice within 5 seconds writes nothing.
- The connection banner writes an entry when it appears, when it changes between reconnecting and failed, and when the
  failure code changes (for example audio/video interruption ↔ offline). Meeting-service recovery ↔ offline does not
  write again. Interruptions that recover within a second write nothing.
- Leaving the meeting yourself writes nothing, and nothing is written after leaving has started or after the element
  was removed from the page.
- Entries never contain the join token, participant IDs, display names, device IDs or labels, error messages, stack
  traces, or URLs.

## CDN global: `StrevokitShell`

The CDN build, `dist/strevokit-shell.min.js`, defines `<strevokit-meeting>` and sets a frozen `window.StrevokitShell`
object. If `StrevokitShell` already exists, it is left as it is.

| Member | Description |
|---|---|
| `StrevokitShell.mount` | The same `mount()` function. |
| `StrevokitShell.StrevokitMeetingElement` | The element class. |
| `StrevokitShell.version` | The package version, for support requests. |

```html
<script>
  const shell = StrevokitShell.mount("#call-area", { token: joinToken, realtimeUrl: "wss://realtime.example.com" });
</script>
```

## Styling

Import `@strevokit/shell/styles.css` once (or link `dist/styles.css` from the CDN). Customize the look with the
`--svk-*` variables and the `appearance` attribute; see the [theming guide](./theming.md). Class names inside the
element are not part of the API.
