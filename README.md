# Strevokit meeting shell

Source for [`@strevokit/shell`](https://www.npmjs.com/package/@strevokit/shell), a ready-made, accessible meeting UI
for any web front end. It is one custom element, `<strevokit-meeting>`, plus one stylesheet, and it works the same in
plain HTML, React, Vue, Angular, or any other framework. The meeting SDK
([`@strevokit/meeting-sdk`](https://www.npmjs.com/package/@strevokit/meeting-sdk)) is built in, and `lit` is the only
dependency.

## Install

```bash
npm install @strevokit/shell
```

## Two ways to mount it

With the `mount()` function:

```ts
import { mount } from "@strevokit/shell";
import "@strevokit/shell/styles.css";

const shell = mount("#call-area", { token: joinToken, realtimeUrl: "wss://realtime.example.com" });
```

Or with the element in your markup (the join token is a property only, never an attribute):

```html
<strevokit-meeting id="meeting" realtime-url="wss://realtime.example.com"></strevokit-meeting>
<script type="module">
  import "@strevokit/shell";
  document.getElementById("meeting").token = joinToken;
</script>
```

Join tokens are minted by your backend with its Strevokit API credential; never send that credential to the browser.

## CDN (no build step)

Each release is served by jsDelivr from npm. The release notes list the `sha384` integrity hashes for both files:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@strevokit/shell@<version>/dist/styles.css"
      integrity="sha384-<hash>" crossorigin="anonymous">
<script src="https://cdn.jsdelivr.net/npm/@strevokit/shell@<version>/dist/strevokit-shell.min.js"
        integrity="sha384-<hash>" crossorigin="anonymous"></script>
<script>
  StrevokitShell.mount("#call-area", { token: joinToken, realtimeUrl: "wss://realtime.example.com" });
</script>
```

## Documentation

The quick start, styling, and security notes are in the [package README](./packages/meeting-shell/README.md). Backend
routes for create meeting, authorize participants, and join tokens are in the
[Backend API](./packages/meeting-shell/docs/backend-api.md). See also the
[API reference](./packages/meeting-shell/docs/api-reference.md), the
[theming guide](./packages/meeting-shell/docs/theming.md), the
[accessibility statement](./packages/meeting-shell/docs/accessibility.md), and the
[examples](./packages/meeting-shell/docs/examples/) for plain JavaScript, the CDN, React, Vue, Angular, and a backend
that creates meetings, authorizes participants, and mints join tokens.

## Repository status

This repository is a **read-only mirror** of the shell source. Changes are made upstream and synced here as single
commits; each commit message names the upstream commit it came from. Pull requests are not merged here: maintainers
move any accepted change into the upstream source, and it arrives with the next sync.

## Issues

Report problems through [GitHub Issues](https://github.com/AgiliaIT/strevokit-shell/issues). See
[CONTRIBUTING.md](./CONTRIBUTING.md) for what to include.

## Building from source

Requires Node.js 22.12 or later. The meeting SDK is bundled into the builds, so it is installed from npm for the
version range in the package's `strevokitSdk` field.

```bash
cd packages/meeting-shell
npm ci
npm run sdk:install   # installs @strevokit/meeting-sdk for bundling without changing the lockfile
npm run build         # dist/index.js, dist/strevokit-shell.min.js, dist/styles.css
npm test
```

| Path | Contents |
|---|---|
| `packages/meeting-shell/` | The published `@strevokit/shell` package |
| `scripts/ci/shell.sh` | The CI stages run by this repository's workflows |

## Releases and provenance

Versions are published to npm from this repository's `release` workflow with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements), so each published version links back to the
commit it was built from. Release tags are named `shell-v<version>`. Changes are listed in the
[changelog](./packages/meeting-shell/CHANGELOG.md).

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
