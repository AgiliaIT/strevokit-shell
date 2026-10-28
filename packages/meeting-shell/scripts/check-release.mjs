// Release guard: the version has a changelog entry naming the bundled meeting SDK and Lit, and a public-surface break
// since the last tag (the API report or the documented theme variables) forces a semver bump.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { diffApiReports } from "./apiDiff.mjs";
import { fail, readJson, root } from "./lib.mjs";
import { diffThemeVariables } from "./themeVariables.mjs";

const TAG_PREFIX = "shell-v";

const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/.exec(version);
  if (!match) fail(`"${version}" is not a semver version.`);
  return match.slice(1, 4).map(Number);
}

/** The changelog section body for `heading` (e.g. "0.1.0" or "Unreleased"), or null when absent. */
function changelogSection(changelog, heading) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${heading}]`));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

/** `file` (relative to the package) as of `tag`, or null when the tag doesn't have it. */
function fileAtTag(tag, file) {
  const path = relative(git(["rev-parse", "--show-toplevel"]), join(root, file)).split("\\").join("/");
  try {
    return git(["show", `${tag}:${path}`]);
  } catch {
    return null;
  }
}

const { version } = readJson(join(root, "package.json"));
const current = parseVersion(version);
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const tags = git(["tag", "--list", `${TAG_PREFIX}*`, "--sort=-v:refname"]).split("\n").filter(Boolean);
const releasedTag = tags.find((tag) => tag === `${TAG_PREFIX}${version}`);

const section = changelogSection(changelog, version) ?? (releasedTag ? null : changelogSection(changelog, "Unreleased"));
if (section === null) {
  fail(`CHANGELOG.md has no "## [${version}]" section${releasedTag ? "" : ' (or "## [Unreleased]")'}.`);
}
if (!/@strevokit\/meeting-sdk[`@\s]*v?\d+\.\d+\.\d+/.test(section) || !/\bLit\b/.test(section)) {
  fail(`CHANGELOG.md section for ${version} must name the bundled @strevokit/meeting-sdk version and Lit.`);
}

const previousTag = tags.find((tag) => tag !== releasedTag);
if (!previousTag) {
  console.log(`check:release: ${version} has a changelog entry; no earlier ${TAG_PREFIX}* tag, so no surface diff.`);
  process.exit(0);
}

const previousReport = fileAtTag(previousTag, "etc/shell.api.md");
if (previousReport === null) fail(`check:release: ${previousTag} has no etc/shell.api.md; cannot diff the public surface.`);
const previousTheming = fileAtTag(previousTag, "docs/theming.md");
if (previousTheming === null) fail(`check:release: ${previousTag} has no docs/theming.md; cannot diff the theme variables.`);

const api = diffApiReports(previousReport, readFileSync(join(root, "etc", "shell.api.md"), "utf8"));
const variables = diffThemeVariables(previousTheming, readFileSync(join(root, "docs", "theming.md"), "utf8"));
const breaking = [...api.breaking, ...variables.breaking];
for (const change of [...api.additive, ...variables.additive]) console.log(`  + ${change}`);

if (breaking.length === 0) {
  console.log(`check:release: ${version} has a changelog entry; public surface is additive since ${previousTag}.`);
  process.exit(0);
}

const previous = parseVersion(previousTag.slice(TAG_PREFIX.length));
const bumped = current[0] >= 1 ? current[0] > previous[0] : current[0] > previous[0] || current[1] > previous[1];
const documented = /^### (?:Breaking|Changed)\b/m.test(section);
if (!bumped || !documented) {
  console.error(`check:release: the public surface changed incompatibly since ${previousTag}:`);
  for (const change of breaking) console.error(`  - ${change}`);
  if (!bumped) console.error(`  ${version} needs a ${current[0] >= 1 ? "major" : "minor"} bump over ${previousTag}.`);
  if (!documented) console.error(`  The ${version} changelog section needs a "### Breaking" or "### Changed" section with migration notes.`);
  process.exit(1);
}
console.log(`check:release: breaking change since ${previousTag} is versioned and documented in ${version}.`);
