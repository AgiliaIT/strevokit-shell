import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const root = postcss.parse(readFileSync(join(import.meta.dirname, "..", "src", "styles", "meeting.css"), "utf8"));

/** The hex colour custom properties declared by rules whose selector is exactly `selector`. */
function tokens(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  root.walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls(/^--svk-/u, (decl) => {
      if (/^#[0-9a-f]{6}$/iu.test(decl.value)) found[decl.prop] = decl.value;
    });
  });
  if (Object.keys(found).length === 0) throw new Error(`no colour tokens for selector: ${selector}`);
  return found;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const light = tokens(":where(strevokit-meeting)");
const dark = { ...light, ...tokens(':where(strevokit-meeting[data-svk-appearance="dark"])') };
const system = { ...light, ...tokens(':where(strevokit-meeting[data-svk-appearance="system"])') };

const SURFACES = ["--svk-surface", "--svk-surface-raised"];
const TEXT = ["--svk-text", "--svk-text-muted"];
const NON_TEXT = ["--svk-border", "--svk-focus", "--svk-on", "--svk-off", "--svk-danger", "--svk-warning"];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s tokens", (_name, palette) => {
  const get = (token: string): string => {
    const value = palette[token];
    if (!value) throw new Error(`missing ${token}`);
    return value;
  };

  it.each(TEXT.flatMap((text) => SURFACES.map((surface) => [text, surface])))("%s on %s is at least 4.5:1", (text, surface) => {
    expect(ratio(get(text), get(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT.flatMap((token) => SURFACES.map((surface) => [token, surface])))(
    "%s on %s is at least 3:1",
    (token, surface) => {
      expect(ratio(get(token), get(surface))).toBeGreaterThanOrEqual(3);
    },
  );

  it.each([
    ["--svk-on", "--svk-surface-raised"],
    ["--svk-off", "--svk-surface-raised"],
  ])("state text %s on %s is at least 4.5:1", (text, surface) => {
    expect(ratio(get(text), get(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it("button text on the accent and danger fills is at least 4.5:1", () => {
    expect(ratio(get("--svk-accent-text"), get("--svk-accent"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(get("--svk-danger-text"), get("--svk-danger"))).toBeGreaterThanOrEqual(4.5);
  });

  it("tile text is at least 4.5:1 on the tile background", () => {
    expect(ratio(get("--svk-tile-text"), get("--svk-tile"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("system appearance", () => {
  it("uses the dark palette under prefers-color-scheme: dark", () => {
    expect(system).toEqual(dark);
  });
});
