// The documentation covers the whole public surface: docs/api-reference.md names every export in etc/shell.api.md,
// every mount() option and handle member, the element's attributes, properties, method, and events, and every close
// reason; docs/theming.md lists exactly the --svk-* variables the stylesheet declares.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, root } from "./lib.mjs";
import { declaredVariables, documentedVariables } from "./themeVariables.mjs";

const read = (...path) => readFileSync(join(root, ...path), "utf8").replace(/\r\n?/g, "\n");
const report = read("etc", "shell.api.md");
const reference = read("docs", "api-reference.md");
const theming = read("docs", "theming.md");
const elementSource = read("src", "elements", "strevokit-meeting.ts");
const stylesheet = read("src", "styles", "meeting.css");

/** The body of `export <kind> <name> ... {` up to its closing brace at column 0 in the API report. */
function declarationBody(kind, name) {
  return new RegExp(`^export ${kind} ${name}\\b[^\\n]*\\{\\n([\\s\\S]*?)\\n\\}`, "m").exec(report)?.[1] ?? "";
}

/** Member names of a report declaration that carry documentation (API Extractor marks the others "undocumented"). */
function documentedMembers(kind, name) {
  const names = [];
  let undocumented = false;
  for (const line of declarationBody(kind, name).split("\n")) {
    if (line.trim() === "// (undocumented)") {
      undocumented = true;
      continue;
    }
    const member = /^ {4}(?!protected |static |constructor\b)(?:readonly |get |set )?([\w$]+)[?(<:]/.exec(line);
    if (member && !undocumented && !names.includes(member[1])) names.push(member[1]);
    if (/^ {4}\S/.test(line)) undocumented = false;
  }
  return names;
}

/** Attribute names from the element's `static properties`: `attribute: "x"`, none for `attribute: false`, else lowercase. */
function attributes() {
  const block = /static (?:override )?properties = \{([\s\S]*?)\n {2}\};/.exec(elementSource)?.[1] ?? "";
  return [...block.matchAll(/^ {4}(\w+): \{([^}]*)\}/gm)].flatMap(([, name, options]) => {
    if (/attribute:\s*false/.test(options)) return [];
    return [/attribute:\s*"([^"]+)"/.exec(options)?.[1] ?? name.toLowerCase()];
  });
}

const exportNames = [...report.matchAll(/^export (?:declare )?(?:function|class|interface|type|const) (\w+)/gm)].map((m) => m[1]);
const options = documentedMembers("interface", "MountOptions");
const handle = documentedMembers("interface", "ShellHandle");
const element = documentedMembers("class", "StrevokitMeetingElement");
const attributeNames = attributes();
const events = [...declarationBody("interface", "MeetingShellEventMap").matchAll(/"(svk-[\w-]+)"/g)].map((m) => m[1]);
const reasonUnion = /export type MeetingShellCloseReason = ([^;]+);/.exec(report)?.[1] ?? "";
const reasons = [...reasonUnion.matchAll(/"(\w+)"/g)].map((m) => m[1]);

const groups = { exportNames, options, handle, element, attributeNames, events, reasons };
const empty = Object.entries(groups).filter(([, names]) => names.length === 0);
if (empty.length > 0) {
  fail(`check:docs could not read ${empty.map(([group]) => group).join(", ")} from etc/shell.api.md or the element source.`);
}

const documented = (name) => new RegExp(`\`${name.replace(/[$]/g, "\\$")}[\`(<?=]`).test(reference);
const reasonDocumented = (reason) => reference.includes(`\`"${reason}"\``) || reference.includes(`\`${reason}\``);
const missing = [
  ...exportNames.filter((name) => !documented(name)).map((name) => `export ${name}`),
  ...options.filter((name) => !documented(name)).map((name) => `mount() option ${name}`),
  ...handle.filter((name) => !documented(name)).map((name) => `ShellHandle member ${name}`),
  ...element.filter((name) => !documented(name)).map((name) => `element property or method ${name}`),
  ...attributeNames.filter((name) => !documented(name)).map((name) => `element attribute ${name}`),
  ...events.filter((name) => !documented(name)).map((name) => `event ${name}`),
  ...reasons.filter((reason) => !reasonDocumented(reason)).map((reason) => `close reason ${reason}`),
];
if (!/`StrevokitShell[`.]/.test(reference)) missing.push("the CDN global StrevokitShell");

const declared = declaredVariables(stylesheet);
const listed = documentedVariables(theming);
const variableProblems = [
  ...declared.filter((name) => !listed.includes(name)).map((name) => `${name} is declared in meeting.css but not listed`),
  ...listed.filter((name) => !declared.includes(name)).map((name) => `${name} is listed but not declared in meeting.css`),
  ...listed.filter((name, i) => listed.indexOf(name) !== i).map((name) => `${name} is listed twice`),
];

if (missing.length > 0 || variableProblems.length > 0) {
  if (missing.length > 0) console.error("docs/api-reference.md is missing:");
  for (const item of missing) console.error(`  ${item}`);
  if (variableProblems.length > 0) console.error("docs/theming.md variable table:");
  for (const item of variableProblems) console.error(`  ${item}`);
  process.exit(1);
}
console.log(
  `check:docs: ${exportNames.length} exports, ${options.length} options, ${handle.length} handle members, ` +
    `${element.length} element members, ${attributeNames.length} attributes, ${events.length} events, ` +
    `${reasons.length} close reasons, ${listed.length} theme variables documented`,
);
