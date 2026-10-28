import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declaredVariables, diffThemeVariables, documentedVariables } from "../scripts/themeVariables.mjs";

const THEMING = `# Theming

\`\`\`css
strevokit-meeting { --svk-accent: #7c3aed; --svk-unlisted: 1px; }
\`\`\`

| Variable | Purpose | Light default | Dark default |
|---|---|---|---|
| \`--svk-surface\` | Main background | \`#ffffff\` | \`#18181b\` |
| \`--svk-accent\` | Primary buttons | \`#2563eb\` | \`#60a5fa\` |

Set \`--svk-radius\` in prose; only table rows count.
`;

describe("documentedVariables", () => {
  it("reads the variable table rows only, in order", () => {
    expect(documentedVariables(THEMING)).toEqual(["--svk-surface", "--svk-accent"]);
  });
});

describe("declaredVariables", () => {
  it("reads each declared variable once, ignoring uses", () => {
    const css = ":where(a) { --svk-text: #000; color: var(--svk-text); --svk-gap: 4px; }\n:where(b) { --svk-text: #fff; }";
    expect(declaredVariables(css)).toEqual(["--svk-text", "--svk-gap"]);
  });

  it("finds the 19 variables of the shipped stylesheet", () => {
    const css = readFileSync(join(import.meta.dirname, "..", "src", "styles", "meeting.css"), "utf8");
    expect(declaredVariables(css)).toHaveLength(19);
  });
});

describe("diffThemeVariables", () => {
  it("reports no change for the same document", () => {
    expect(diffThemeVariables(THEMING, THEMING)).toEqual({ breaking: [], additive: [] });
  });

  it("treats a removed variable as breaking and a new one as additive", () => {
    const renamed = THEMING.replace("`--svk-accent` | Primary", "`--svk-primary` | Primary");
    expect(diffThemeVariables(THEMING, renamed)).toEqual({
      breaking: ["removed theme variable --svk-accent"],
      additive: ["added theme variable --svk-primary"],
    });
  });
});
