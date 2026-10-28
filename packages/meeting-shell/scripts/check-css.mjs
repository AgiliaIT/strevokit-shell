// Checks the shape of src/styles/meeting.css: every rule is scoped to <strevokit-meeting> and targets svk- parts, the
// theme variables and sizing defaults have zero specificity, a reset undoes page styles first, and nothing uses
// !important, cascade layers, or the document root. Prints each problem with its line.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import postcss from "postcss";
import { fail, root } from "./lib.mjs";

const FILE = join(root, "src", "styles", "meeting.css");
const NAME = relative(root, FILE);
const SCOPE = "strevokit-meeting[data-svk-appearance]";
const RESET = `${SCOPE} [class*="svk-"]`;
const DEFAULTS = new Set([
  ":where(strevokit-meeting)",
  ':where(strevokit-meeting[data-svk-appearance="dark"])',
  ':where(strevokit-meeting[data-svk-appearance="system"])',
]);
const SIZING = new Set(["display", "width", "height", "min-height", "container-type"]);
const AT_RULES = new Set(["media", "container", "supports"]);
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
const PART = /^(\.svk-[\w-]+|\[class\*="svk-"\])/u;

let tree;
try {
  tree = postcss.parse(readFileSync(FILE, "utf8"), { from: FILE });
} catch (error) {
  fail(`check:css: ${NAME} could not be parsed: ${error.message}`);
}

const problems = [];
const report = (node, message) => problems.push(`${NAME}:${node.source?.start?.line ?? "?"} ${message}`);

tree.walkAtRules((rule) => {
  if (!AT_RULES.has(rule.name)) report(rule, `@${rule.name} is not allowed (only @media, @container, @supports).`);
});

tree.walkDecls((decl) => {
  if (decl.important) report(decl, `"${decl.prop}" uses !important; the shell never does, so tenants can theme it.`);
});

let resetIndex = -1;
let firstPartIndex = -1;
let index = 0;
tree.walkRules((rule) => {
  const props = rule.nodes.filter((node) => node.type === "decl").map((decl) => decl.prop);
  for (const raw of rule.selectors) {
    const selector = raw.trim();
    if (/:root|(^|[\s>+~(])(html|body)(?![\w-])/u.test(selector)) {
      report(rule, `"${selector}" targets the document root, html, or body.`);
      continue;
    }
    for (const match of selector.matchAll(/\.([\w-]+)/gu)) {
      if (!match[1].startsWith("svk-")) report(rule, `"${selector}" uses the class ".${match[1]}"; shell classes start with svk-.`);
    }
    if (selector.startsWith(":where(")) {
      if (!DEFAULTS.has(selector)) {
        report(rule, `"${selector}": :where() is only for the theme variable and sizing defaults on strevokit-meeting.`);
        continue;
      }
      for (const prop of props) {
        if (!prop.startsWith("--svk-") && !(selector === ":where(strevokit-meeting)" && SIZING.has(prop))) {
          report(rule, `"${selector}" sets "${prop}"; zero-specificity rules may only set --svk-* variables or sizing.`);
        }
      }
      continue;
    }
    for (const prop of props) {
      if (prop.startsWith("--")) report(rule, `"${selector}" declares "${prop}"; theme variables belong in the :where() defaults.`);
    }
    if (!selector.startsWith(SCOPE)) {
      report(rule, `"${selector}" must start with ${SCOPE}.`);
      continue;
    }
    if (selector === SCOPE) {
      const missing = INHERITED.filter((prop) => !props.includes(prop));
      if (missing.length > 0) report(rule, `the element rule must reset ${missing.join(", ")}.`);
      continue;
    }
    if (selector === RESET && props.includes("all")) resetIndex = resetIndex === -1 ? index : resetIndex;
    const compounds = selector.slice(SCOPE.length).trim().split(/\s*[\s>+~]\s*/u).filter(Boolean);
    const bad = compounds.find((compound) => !PART.test(compound));
    if (bad !== undefined) {
      report(rule, `"${selector}": "${bad}" must target a shell part (an svk- class), not an element.`);
    } else if (firstPartIndex === -1 && selector !== RESET) {
      firstPartIndex = index;
    }
  }
  index += 1;
});

if (resetIndex === -1) {
  problems.push(`${NAME}: the part reset "${RESET} { all: revert; }" is missing.`);
} else if (firstPartIndex !== -1 && resetIndex > firstPartIndex) {
  problems.push(`${NAME}: the part reset must come before every other shell part rule.`);
}

if (problems.length > 0) {
  console.error(`check:css: ${problems.length} problem(s) in ${NAME}:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`check:css: ${NAME} is scoped to strevokit-meeting (${index} rules).`);
