import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "..", "src", "styles", "meeting.css"), "utf8");
const root = postcss.parse(css);

const SCOPE = "strevokit-meeting[data-svk-appearance]";
const RESET = `${SCOPE} [class*="svk-"]`;
const DEFAULTS = [
  ":where(strevokit-meeting)",
  ':where(strevokit-meeting[data-svk-appearance="dark"])',
  ':where(strevokit-meeting[data-svk-appearance="system"])',
];
const SIZING = ["display", "width", "height", "min-height", "container-type"];
const INHERITED = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-transform",
  "text-indent",
  "color",
  "direction",
  "white-space",
  "visibility",
  "cursor",
  "box-sizing",
];

const rules: Rule[] = [];
root.walkRules((rule) => {
  rules.push(rule);
});
const selectors = rules.flatMap((rule) => rule.selectors.map((selector) => selector.trim()));
const scoped = selectors.filter((selector) => !selector.startsWith(":where("));
const properties = (rule: Rule | undefined): string[] => rule?.nodes.flatMap((n) => (n.type === "decl" ? [n.prop] : [])) ?? [];
const ruleFor = (selector: string): Rule | undefined => rules.find((rule) => rule.selector === selector);

/** The compounds after the scope prefix, for example `.svk-toggle[data-state="on"]` and `.svk-icon`. */
function compoundsAfterScope(selector: string): string[] {
  return selector.slice(SCOPE.length).trim().split(/\s*[\s>+~]\s*/u).filter(Boolean);
}

describe("stylesheet scope", () => {
  it("has rules", () => {
    expect(rules.length).toBeGreaterThan(20);
  });

  it("uses no cascade layers, !important, or @import", () => {
    const atRules: string[] = [];
    root.walkAtRules((rule: AtRule) => {
      atRules.push(rule.name);
    });
    expect(atRules.filter((name) => !["media", "container", "supports"].includes(name))).toEqual([]);
    const important: string[] = [];
    root.walkDecls((decl) => {
      if (decl.important) important.push(`${decl.parent?.type === "rule" ? (decl.parent as Rule).selector : "?"} ${decl.prop}`);
    });
    expect(important).toEqual([]);
  });

  it("declares theme variables only as zero-specificity :where() defaults, with the --svk- prefix", () => {
    const declaredIn = new Set<string>();
    root.walkDecls(/^--/u, (decl) => {
      expect(decl.prop).toMatch(/^--svk-/u);
      declaredIn.add((decl.parent as Rule).selector);
    });
    expect([...declaredIn].sort()).toEqual([...DEFAULTS].sort());
  });

  it("puts the dark defaults for system inside prefers-color-scheme: dark", () => {
    const system = ruleFor(DEFAULTS[2]!);
    const parent = system?.parent as AtRule | undefined;
    expect(parent?.type).toBe("atrule");
    expect(parent?.params).toBe("(prefers-color-scheme: dark)");
  });

  it("sets the element's sizing defaults at zero specificity", () => {
    const sizing = rules.filter((rule) => rule.selector === DEFAULTS[0] && !properties(rule).some((p) => p.startsWith("--")));
    expect(sizing).toHaveLength(1);
    expect(properties(sizing[0]).sort()).toEqual([...SIZING].sort());
  });

  it("adapts to the element's width with a container query, never the viewport's", () => {
    const sizing = rules.find((rule) => rule.selector === DEFAULTS[0] && properties(rule).includes("container-type"));
    const containerType = sizing?.nodes.find((node) => node.type === "decl" && node.prop === "container-type");
    expect(containerType && "value" in containerType ? containerType.value : null).toBe("inline-size");
    const containers: AtRule[] = [];
    const mediaParams: string[] = [];
    root.walkAtRules((rule) => {
      if (rule.name === "container") containers.push(rule);
      if (rule.name === "media") mediaParams.push(rule.params);
    });
    expect(containers.map((rule) => rule.params)).toEqual(["(max-width: 479px)"]);
    expect(containers[0]?.nodes?.length).toBeGreaterThan(0);
    expect(mediaParams.filter((params) => /width/u.test(params))).toEqual([]);
  });

  it("allows :where() only for the variable and sizing defaults", () => {
    const where = selectors.filter((selector) => selector.startsWith(":where("));
    expect(where.filter((selector) => !DEFAULTS.includes(selector))).toEqual([]);
  });

  it("resets every inherited property on the element itself", () => {
    expect(properties(ruleFor(SCOPE))).toEqual(expect.arrayContaining(INHERITED));
  });

  it("reverts page styles on every shell part before any component rule", () => {
    const reset = ruleFor(RESET);
    expect(properties(reset)).toEqual(["all", "box-sizing"]);
    expect(reset?.nodes.find((n) => n.type === "decl" && n.prop === "all")).toMatchObject({ value: "revert" });
    const firstPart = rules.findIndex((rule) => rule.selectors.some((s) => s.startsWith(`${SCOPE} .svk-`)));
    expect(rules.indexOf(reset!)).toBeLessThan(firstPart);
  });

  it("starts every other selector with the scope prefix", () => {
    expect(scoped.filter((selector) => !selector.startsWith(SCOPE))).toEqual([]);
  });

  it("targets only svk- parts after the prefix, never bare elements", () => {
    const offenders = scoped
      .filter((selector) => selector !== SCOPE)
      .filter((selector) =>
        compoundsAfterScope(selector).some(
          (compound) => !/^(\.svk-[\w-]+|\[class\*="svk-"\])/u.test(compound),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("uses only svk- class names", () => {
    const classes = selectors.flatMap((selector) => [...selector.matchAll(/\.([\w-]+)/gu)].map((match) => match[1]));
    expect(classes.filter((name) => !name?.startsWith("svk-"))).toEqual([]);
  });

  it("never targets the document root, html, or body", () => {
    expect(selectors.filter((selector) => /:root|(^|[\s>+~(])(html|body)(?![\w-])/u.test(selector))).toEqual([]);
  });
});
