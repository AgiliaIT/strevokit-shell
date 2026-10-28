import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
  version: string;
};

afterEach(() => {
  Reflect.deleteProperty(window, "StrevokitShell");
  vi.resetModules();
});

describe("CDN entry", () => {
  it("sets the StrevokitShell global with mount, the element class, and the version", async () => {
    vi.resetModules();
    await import("../src/cdn.js");
    const global = window.StrevokitShell;
    expect(global?.version).toBe(version);
    expect(typeof global?.mount).toBe("function");
    expect(customElements.get("strevokit-meeting")).toBeDefined();
    expect(global?.StrevokitMeetingElement.prototype).toBeInstanceOf(HTMLElement);
    expect(Object.isFrozen(global)).toBe(true);
  });

  it("keeps a StrevokitShell global that is already set", async () => {
    const existing = Object.freeze({ ...(await import("../src/index.js")), version: "0.0.0-existing" });
    window.StrevokitShell = existing;
    vi.resetModules();
    await import("../src/cdn.js");
    expect(window.StrevokitShell).toBe(existing);
  });
});
