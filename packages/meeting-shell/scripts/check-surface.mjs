// Public surface guard: no `any` in the shipped types; no media-topology vocabulary in the types, the docs, the source
// (template text, the copy table, and code, minus comments), or the class names; and an exports map with exactly the
// documented entry points.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readJson, requireBuild, root } from "./lib.mjs";

const TOPOLOGY_TERMS = ["p2p", "peer-to-peer", "sfu", "mediasoup", "ice", "sdp", "router", "transport", "producer", "consumer", "webrtc"];
const EXPORT_KEYS = [".", "./styles.css", "./package.json"];
const STYLESHEET = join(root, "src", "styles", "meeting.css");

/** Reviewed exceptions: `{ file, term, reason }`. */
const ALLOWED_TERMS = [];

const words = TOPOLOGY_TERMS.map((term) => term.replace(/-/g, "\\-")).join("|");
// "TURN" (the relay protocol) only in capitals: "Turn on sound" is contracted UI copy.
const termPattern = new RegExp(`(?<![\\w-])(?:(${words})|(TURN))(?![\\w-])`, "gi");
const turnPattern = /^TURN$/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Removes comments but keeps every line break, so findings keep their line numbers. `://` in URLs is not a comment. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, "")).replace(/(?<!:)\/\/.*$/gm, "");
}

function findTerms(text) {
  const found = [];
  for (const match of text.matchAll(termPattern)) {
    if (match[1]) found.push(match[1].toLowerCase());
    else if (turnPattern.test(match[2])) found.push("turn");
  }
  return found;
}

/** Topology terms inside `svk-*` class and element names, which the word pattern skips because they are hyphen-joined. */
function classNameTerms(name) {
  if (name.includes("peer-to-peer")) return ["peer-to-peer"];
  return name
    .split("-")
    .slice(1)
    .filter((part) => TOPOLOGY_TERMS.includes(part));
}

requireBuild();
const declarations = readFileSync(join(root, "dist", "index.d.ts"), "utf8");
const problems = [];

const anyCount = [...stripComments(declarations).matchAll(/(?<![\w$."'])any(?![\w$"'])/g)].length;
if (anyCount > 0) problems.push(`dist/index.d.ts uses \`any\` ${anyCount} time(s)`);

const sources = walk(join(root, "src")).filter((path) => path.endsWith(".ts"));
const sourceTexts = sources.map((path) => [relative(root, path), stripComments(readFileSync(path, "utf8"))]);
const stylesheet = stripComments(readFileSync(STYLESHEET, "utf8"));
const scanned = [
  ["dist/index.d.ts", declarations],
  ["README.md", readFileSync(join(root, "README.md"), "utf8")],
  ...walk(join(root, "docs")).map((path) => [relative(root, path), readFileSync(path, "utf8")]),
  ...sourceTexts,
];

let termCount = 0;
const report = (file, term, where) => {
  if (ALLOWED_TERMS.some((entry) => entry.file === file && entry.term === term)) return;
  termCount += 1;
  problems.push(`${file}${where} topology term "${term}"`);
};

for (const [file, text] of scanned) {
  text.split("\n").forEach((line, i) => {
    for (const term of findTerms(line)) report(file, term, `:${i + 1}`);
  });
}

const classNames = new Set();
for (const [, text] of [...sourceTexts, ["", stylesheet]]) {
  for (const [name] of text.matchAll(/\bsvk-[a-z0-9-]*[a-z0-9]/g)) classNames.add(name);
}
for (const name of classNames) {
  for (const term of classNameTerms(name)) report("class and element names", term, ` (${name})`);
}

const exportKeys = Object.keys(readJson(join(root, "package.json")).exports ?? {});
if (JSON.stringify(exportKeys) !== JSON.stringify(EXPORT_KEYS)) {
  problems.push(`package.json exports are [${exportKeys.join(", ")}]; expected [${EXPORT_KEYS.join(", ")}]`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(
  `check:surface: ${termCount} topology terms, ${anyCount} any, ${sources.length} source files, ${classNames.size} svk- names, exports ${exportKeys.join(" ")}`,
);
