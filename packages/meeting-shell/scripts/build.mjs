// Builds the package: the ESM module (the shell with the meeting SDK bundled; lit stays external), the CDN script
// (an IIFE with everything bundled, which sets the StrevokitShell global), the stylesheet, and the rolled-up type
// declarations.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => join(root, "node_modules", ".bin", name);
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const LIT_PACKAGES = ["lit", "lit-html", "lit-element", "@lit/reactive-element"];
const EXTERNAL = LIT_PACKAGES.flatMap((name) => [name, `${name}/*`]);
const isExternal = (specifier) => LIT_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  // The maps point at the bundled lit and SDK sources by path only; their text is not republished inside the maps.
  sourcesContent: false,
  metafile: true,
  legalComments: "none",
  logLevel: "warning",
  define: { __STREVOKIT_SHELL_VERSION__: JSON.stringify(version) },
};

rmSync(join(root, "dist"), { recursive: true, force: true });
rmSync(join(root, "build"), { recursive: true, force: true });

run(bin("tsc"), ["-p", "tsconfig.json"]);

const moduleBuild = await build({
  ...common,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  format: "esm",
  external: EXTERNAL,
  minify: false,
});

const cdnBuild = await build({
  ...common,
  entryPoints: ["src/cdn.ts"],
  outfile: "dist/strevokit-shell.min.js",
  format: "iife",
  minify: true,
});

mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(join(root, "build", "meta-module.json"), JSON.stringify(moduleBuild.metafile, null, 2));
writeFileSync(join(root, "build", "meta-cdn.json"), JSON.stringify(cdnBuild.metafile, null, 2));
copyFileSync(join(root, "src", "styles", "meeting.css"), join(root, "dist", "styles.css"));

mkdirSync(join(root, "etc"), { recursive: true });
// The build fails when the public API differs from etc/shell.api.md; `npm run api:update` accepts the change.
const local = process.argv.includes("--update-api") ? ["--local"] : [];
try {
  run(bin("api-extractor"), ["run", ...local]);
} catch {
  console.error("The public API changed. Review it, then run `npm run api:update` to accept the new etc/shell.api.md.");
  process.exit(1);
}

// API Extractor drops `declare global` blocks from the rollup, so the HTMLElementTagNameMap entry is carried over.
// The rollup is written under build/, so `api:check` re-running API Extractor never changes the shipped dist/index.d.ts.
const globalBlock = readFileSync(join(root, "build", "types", "types.d.ts"), "utf8").match(/^declare global \{[\s\S]*?^\}/m);
if (!globalBlock || !globalBlock[0].includes("HTMLElementTagNameMap")) {
  console.error("build/types/types.d.ts has no HTMLElementTagNameMap augmentation for <strevokit-meeting>.");
  process.exit(1);
}
const rollup = readFileSync(join(root, "build", "rollup", "index.d.ts"), "utf8");
writeFileSync(join(root, "dist", "index.d.ts"), `${rollup.trimEnd()}\n\n${globalBlock[0]}\n`);

const moduleCode = readFileSync(join(root, "dist", "index.js"), "utf8");
const imported = [...moduleCode.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^./][^"']*)["']/gm)].map((m) => m[1]);
const bareImports = [...moduleCode.matchAll(/^\s*import\s*["']([^./][^"']*)["']/gm)].map((m) => m[1]);
const unexpected = [...imported, ...bareImports].filter((specifier) => !isExternal(specifier));
if (unexpected.length > 0 || /\bimport\s*\(\s*["'][^./]/.test(moduleCode)) {
  console.error(`dist/index.js imports packages other than lit: ${unexpected.join(", ")}`);
  process.exit(1);
}

const cdnCode = readFileSync(join(root, "dist", "strevokit-shell.min.js"), "utf8");
if (/\bimport\s*\(|^\s*import[\s{"']/m.test(cdnCode) || /\brequire\s*\(/.test(cdnCode)) {
  console.error("dist/strevokit-shell.min.js must not load other modules; everything is bundled into it.");
  process.exit(1);
}
console.log(
  "shell build: dist/index.js, dist/index.d.ts, dist/strevokit-shell.min.js, dist/styles.css (with source maps)",
);
