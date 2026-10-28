// Size budgets (size-budget.json), gzip level 9: the module build (dist/index.js minified, with the meeting SDK and
// without lit) plus the stylesheet, and the CDN build (everything) plus the stylesheet. moduleGzipBytes and
// cdnGzipBytes in build/size-report.json are those budgeted totals; cssGzipBytes is the stylesheet alone.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { constants, gzipSync } from "node:zlib";
import { transform } from "esbuild";
import { readJson, requireBuild, root } from "./lib.mjs";

const gzip = (text) => gzipSync(text, { level: constants.Z_BEST_COMPRESSION }).length;
const read = (file) => readFileSync(join(root, "dist", file), "utf8");

requireBuild();
const budget = readJson(join(root, "size-budget.json"));
const { code: moduleCode } = await transform(read("index.js"), {
  minify: true,
  format: "esm",
  target: "es2022",
  legalComments: "none",
});
const { code: css } = await transform(read("styles.css"), { loader: "css", minify: true, legalComments: "none" });

const cssGzipBytes = gzip(css);
const report = {
  moduleGzipBytes: gzip(moduleCode) + cssGzipBytes,
  cdnGzipBytes: gzip(read("strevokit-shell.min.js")) + cssGzipBytes,
  cssGzipBytes,
  moduleMaxGzipBytes: budget.module.maxGzipBytes,
  cdnMaxGzipBytes: budget.cdn.maxGzipBytes,
};
mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(join(root, "build", "size-report.json"), `${JSON.stringify(report, null, 2)}\n`);

const builds = [
  ["module", report.moduleGzipBytes, report.moduleMaxGzipBytes],
  ["CDN", report.cdnGzipBytes, report.cdnMaxGzipBytes],
];
const lines = builds.map(
  ([name, bytes, max]) => `@strevokit/shell ${name}: ${bytes} B gzipped incl. CSS ${cssGzipBytes} B / budget ${max} B`,
);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.map((line) => `**shell size**: ${line}\n`).join(""));
}
let over = false;
builds.forEach(([, bytes, max], i) => {
  if (bytes > max) {
    over = true;
    console.error(`${lines[i]} (over budget by ${bytes - max} B)`);
  } else {
    console.log(lines[i]);
  }
});
if (over) process.exit(1);
