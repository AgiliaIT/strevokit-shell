// The CDN script entry: defines the element and exposes the StrevokitShell global for pages without a bundler.
import { StrevokitMeetingElement, mount } from "./index.js";

declare const __STREVOKIT_SHELL_VERSION__: string;

interface StrevokitShellGlobal {
  readonly mount: typeof mount;
  readonly StrevokitMeetingElement: typeof StrevokitMeetingElement;
  /** The package version, for support requests. */
  readonly version: string;
}

declare global {
  interface Window {
    StrevokitShell?: StrevokitShellGlobal;
  }
}

if (typeof window !== "undefined" && window.StrevokitShell === undefined) {
  window.StrevokitShell = Object.freeze({ mount, StrevokitMeetingElement, version: __STREVOKIT_SHELL_VERSION__ });
}
