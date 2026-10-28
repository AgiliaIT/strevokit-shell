# Contributing

This repository is a read-only mirror of the Strevokit meeting shell source. Changes are made upstream and synced
here, so pull requests are not merged in this repository. If a pull request is accepted, maintainers move the change
into the upstream source and it arrives here with the next sync.

## Reporting a problem

Open a [GitHub Issue](https://github.com/AgiliaIT/strevokit-shell/issues) and include:

- the `@strevokit/shell` version, and whether you load it from npm or the CDN;
- how you mount it (`mount()` or the `<strevokit-meeting>` element) and the framework you use, if any;
- the browser and its version;
- the close reason from `svk-closed` or `onClosed`, or the message shown on screen, if any;
- for accessibility problems, the assistive technology and its version;
- the steps to reproduce, ideally as a minimal example.

Never include join tokens, API credentials, or other secrets in an issue.

## Security issues

Do not report security vulnerabilities in public issues. Open an issue asking for a private contact instead, without
any details of the vulnerability.
