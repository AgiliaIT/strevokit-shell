# @strevokit/shell

A ready-made, accessible meeting UI for any web app. Add one element to your page and your users get a pre-join screen
with a camera preview and device choice, camera and microphone controls, a participant list, and a clear final screen.

- One custom element, `<strevokit-meeting>`, and one stylesheet. It works the same in plain HTML, React, Vue, Angular,
  or any other front end, with no framework required.
- Two ways to mount it: the `mount()` function, or the element in your markup. A CDN build works with a plain
  `<script>` tag and no build step.
- The meeting SDK is built in. `lit` is the only dependency.
- Keyboard and screen-reader accessible, with light and dark appearances. See the
  [accessibility statement](./docs/accessibility.md).
- Renders inside its own element: no fixed positioning, no styles outside it, and themable through `--svk-*` variables.

## Install

```bash
npm install @strevokit/shell
```

The package is ESM. Use it through a bundler such as Vite, webpack, or Next.js, or load the [CDN build](#cdn-no-build-step).

## Quick start

### 1. Prepare the meeting on your backend

Your backend talks to the Strevokit HTTP API with its API credential, then returns only a short-lived join token to the
browser. **Never** send the API credential to the browser. Full request and response shapes:
[Backend API](./docs/backend-api.md). See also the [Express-style example](./docs/examples/backend-token.md).

```ts
// Server side. Headers on every call:
//   Authorization: Bearer ${process.env.STREVOKIT_API_CREDENTIAL}
//   Content-Type: application/json
const api = "https://api.example.com"; // your Strevokit API base URL
const headers = {
  Authorization: `Bearer ${process.env.STREVOKIT_API_CREDENTIAL}`,
  "Content-Type": "application/json",
};

// Once per environment: allow-list the origin that hosts your page.
await fetch(`${api}/v1/embed-origins`, {
  method: "POST",
  headers,
  body: JSON.stringify({ origin: "https://app.example.com" }),
});

// Create the meeting, then authorize each person who may join.
const { data: meeting } = await fetch(`${api}/v1/meetings`, {
  method: "POST",
  headers,
  body: JSON.stringify({ type: "one_to_one", max_participants: 2 }),
}).then((r) => r.json());

const { data: participant } = await fetch(`${api}/v1/meetings/${meeting.public_id}/participants`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    external_user_id: "user_42",
    display_name: "Alex",
    role: "host",
  }),
}).then((r) => r.json());

// When the signed-in user opens the meeting page, mint a join token and return only data.token.
const { data } = await fetch(`${api}/v1/meetings/${meeting.public_id}/join-token`, {
  method: "POST",
  headers,
  body: JSON.stringify({ participant_public_id: participant.public_id }),
}).then((r) => r.json()); // { token, expires_at, expires_in }
```

### 2a. Mount it with a function

```ts
import { mount } from "@strevokit/shell";
import "@strevokit/shell/styles.css";

const shell = mount("#call-area", {
  token: joinToken,
  realtimeUrl: "wss://realtime.example.com",
  onClosed: (event) => console.log("meeting closed:", event.reason),
});

// Later: shell.leave() to leave the meeting, shell.destroy() to remove the UI.
```

### 2b. Or put the element in your markup

```ts
import "@strevokit/shell"; // defines <strevokit-meeting>
import "@strevokit/shell/styles.css";
```

```html
<strevokit-meeting id="meeting" realtime-url="wss://realtime.example.com"></strevokit-meeting>
<script type="module">
  const meeting = document.getElementById("meeting");
  meeting.addEventListener("svk-closed", (event) => console.log("meeting closed:", event.detail.reason));
  meeting.token = joinToken; // a property only: there is no token attribute
</script>
```

The element fills its container, so give the container a height (without one it is at least 360px tall). Import the
stylesheet once, anywhere in your app.

The join token is set as a property, never as an attribute, so it can't end up in the page markup. To join again after
the meeting closes, mint a new token and set it: a new `token` starts a new meeting from the pre-join screen.

Pass `realtimeUrl` (or the `realtime-url` attribute): until Strevokit publishes a default realtime endpoint, the
element stays idle without one.

### CDN (no build step)

Load the stylesheet and the script from jsDelivr, pinned to an exact version with
[Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity). Each release lists
the `sha384-…` hashes of both files.

```html
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/@strevokit/shell@0.1.0/dist/styles.css"
  integrity="sha384-…"
  crossorigin="anonymous"
/>
<script
  src="https://cdn.jsdelivr.net/npm/@strevokit/shell@0.1.0/dist/strevokit-shell.min.js"
  integrity="sha384-…"
  crossorigin="anonymous"
></script>

<main id="call-area" style="height: 600px"></main>

<script>
  StrevokitShell.mount("#call-area", { token: joinToken, realtimeUrl: "wss://realtime.example.com" });
</script>
```

The script sets the `StrevokitShell` global (`mount`, `StrevokitMeetingElement`, and `version`) and defines
`<strevokit-meeting>`, so the markup style works too. With a Content Security Policy, allow `script-src` and `style-src`
for `cdn.jsdelivr.net` (or host the two files yourself) and `connect-src` for your realtime endpoint.

## Styling

All styles apply inside `<strevokit-meeting>` only, and the shell keeps its look under common page styles. Choose
`appearance="light"`, `"dark"`, or `"system"` (the default), and adjust colours, radius, spacing, and font with the
`--svk-*` variables:

```css
strevokit-meeting {
  --svk-accent: #7c3aed;
  --svk-radius: 4px;
}
```

The [theming guide](./docs/theming.md) lists every variable with its defaults. When you change colours, keeping them
readable is up to you; the guide gives the contrast ratios to meet.

## Frameworks

The element works in any framework that renders HTML. The [examples](./docs/examples/) cover plain JavaScript, the CDN,
React 19 and 18, Vue 3, and Angular, with each framework's setting for custom elements. With server rendering, the
package can be imported on the server: it defines nothing there, and the element starts in the browser.

## Security

- **The join token stays in memory.** It never appears in the page markup (including attributes), URLs, storage,
  events, or log output.
- **Only device choices are stored.** The ID and name of the last chosen camera and microphone are kept in
  `localStorage` so they can be preselected next time. They are never sent anywhere, and nothing else is persisted.
- **Identity comes from the token.** The participant's name and role are decided by your backend when it mints the
  token.

## Versioning

The package follows [semantic versioning](https://semver.org/). The public API is exactly what the
[API reference](./docs/api-reference.md) and the [theming guide](./docs/theming.md) describe: the `mount()` function,
the element's attributes, properties, method, and events, and the `--svk-*` variables. Class names inside the element
are not part of it. Before 1.0.0, breaking changes bump the minor version; from 1.0.0 they bump the major version. See
the [changelog](./CHANGELOG.md).

## Documentation

- [Backend API](./docs/backend-api.md): create meeting, authorize participants, mint join tokens, and related routes
  (`POST` / `GET` / `DELETE` with request and response shapes).
- [API reference](./docs/api-reference.md): `mount()`, the element, every option, attribute, property, event, and
  close reason, and the CDN global.
- [Theming](./docs/theming.md): the `--svk-*` variables, sizing, and known limits.
- [Accessibility](./docs/accessibility.md): what the shell guarantees and its known limits.
- [Examples](./docs/examples/): plain JavaScript, CDN, React, Vue, Angular, and the backend integration flow.

## Source and releases

The source is published at [github.com/AgiliaIT/strevokit-shell](https://github.com/AgiliaIT/strevokit-shell).
Releases are published to npm from that repository with npm provenance, and tagged `shell-v<version>`. Report problems
through its [issues](https://github.com/AgiliaIT/strevokit-shell/issues).
