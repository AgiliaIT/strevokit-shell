// Proves the packed tarball: the file list and manifest, `npm publish --dry-run`, and a clean install (which brings only
// lit) that type-checks a consumer, imports in plain Node without defining anything, mounts both ways in jsdom, runs the
// CDN script in a fresh jsdom window, resolves the stylesheet, and rejects deep imports.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { bin, extract, fail, pack, readJson, root, tempDir } from "./lib.mjs";

const CDN_FILE = "dist/strevokit-shell.min.js";
const REQUIRED_FILES = [
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "dist/index.js",
  "dist/index.js.map",
  "dist/index.d.ts",
  CDN_FILE,
  `${CDN_FILE}.map`,
  "dist/styles.css",
  "docs/api-reference.md",
  "docs/theming.md",
  "docs/accessibility.md",
];
const OPTIONAL_FILES = ["LICENSE"];
const REACT_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](?:react|react-dom)(?:\/[^"']*)?["']/;

const CONSUMER_SOURCE = `
import {
  mount,
  StrevokitMeetingElement,
  type MeetingLogger,
  type MeetingShellAppearance,
  type MeetingShellCloseReason,
  type MeetingShellClosedEvent,
  type MeetingShellEventMap,
  type MeetingShellJoinedEvent,
  type MountOptions,
  type ParticipantRole,
  type ShellHandle,
  type ShellHandleEventMap,
} from "@strevokit/shell";

const logger: MeetingLogger = { debug() {}, info() {}, warn() {}, error() {} };
const appearance: MeetingShellAppearance = "dark";
const options: MountOptions = {
  token: "join-token",
  realtimeUrl: "wss://realtime.example.com",
  appearance,
  logger,
  onJoined: (event: MeetingShellJoinedEvent) => {
    const role: ParticipantRole = event.role;
    void role;
  },
  onClosed: (event: MeetingShellClosedEvent) => {
    const reason: MeetingShellCloseReason = event.reason;
    void reason;
  },
};

export function start(container: HTMLElement): ShellHandle {
  const handle = mount(container, options);
  const element: StrevokitMeetingElement = handle.element;
  void element;
  const off = handle.on("closed", (event: ShellHandleEventMap["closed"]) => void event.reason);
  off();
  void handle.leave().then(() => handle.destroy());
  return handle;
}

export function markup(): StrevokitMeetingElement {
  const element = document.createElement("strevokit-meeting");
  element.token = "join-token";
  element.realtimeUrl = "wss://realtime.example.com";
  element.appearance = "system";
  element.logger = logger;
  element.addEventListener("svk-closed", (event) => {
    const reason: MeetingShellCloseReason = event.detail.reason;
    void reason;
  });
  element.addEventListener("svk-joined", (event: MeetingShellEventMap["svk-joined"]) => void event.detail.role);
  const found: StrevokitMeetingElement | null = document.querySelector("strevokit-meeting");
  void found;
  void element.leave();
  return element;
}
`;

const NODE_SOURCE = `
import assert from "node:assert/strict";
import { createRequire } from "node:module";

assert.equal(typeof window, "undefined");
const shell = await import("@strevokit/shell");
assert.equal(typeof shell.mount, "function");
assert.equal(globalThis.customElements?.get("strevokit-meeting"), undefined);
console.log("node without a DOM: the import doesn't throw and defines nothing");

const require = createRequire(import.meta.url);
assert.match(require.resolve("@strevokit/shell/styles.css"), /dist[\\\\/]styles\\.css$/);
assert.match(import.meta.resolve("@strevokit/shell/styles.css"), /dist\\/styles\\.css$/);
console.log("styles.css resolves through the exports map");

for (const specifier of ["@strevokit/shell/dist/index.js", "@strevokit/shell/dist/strevokit-shell.min.js", "@strevokit/shell/src/index.ts"]) {
  await assert.rejects(import(specifier), (error) => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED");
}
console.log("deep imports are rejected by the exports map");
`;

/** Shared by the jsdom scripts: a page, fake media devices (no devices, permission denied), and a wait helper. */
const DOM_SUPPORT = `
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { JSDOM } = createRequire(process.env.SHELL_PACKAGE_JSON)("jsdom");
const HTML = '<!doctype html><html><body><div id="host"></div></body></html>';
const REALTIME_URL = "wss://realtime.example.com";
// Assembled at runtime: a token-shaped value whose claims carry the meeting and participant IDs, with no signature.
const segment = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = [
  segment({ typ: "JWT" }),
  segment({ meeting_id: "01J00000000000000000000001", participant_id: "01J00000000000000000000002" }),
  "unsigned",
].join(".");

function fakeMediaDevices(window) {
  return {
    enumerateDevices: async () => [],
    getUserMedia: async () => {
      throw new window.DOMException("Permission denied", "NotAllowedError");
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

function page(options = {}) {
  const dom = new JSDOM(HTML, { url: "https://tenant.example.com/meeting", pretendToBeVisual: true, ...options });
  Object.defineProperty(dom.window.navigator, "mediaDevices", { value: fakeMediaDevices(dom.window), configurable: true });
  return dom.window;
}

async function until(check, what) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(\`timed out waiting for \${what}\`);
}

const showsPrejoin = (root) => root.textContent.includes("Ready to join?") && root.textContent.includes("Join meeting");
`;

const DOM_SOURCE = `${DOM_SUPPORT}
const window = page();
const own = new Set(Object.getOwnPropertyNames(globalThis));
for (const key of Object.getOwnPropertyNames(window)) {
  if (own.has(key) && !["Event", "EventTarget", "CustomEvent", "navigator"].includes(key)) continue;
  Object.defineProperty(globalThis, key, { configurable: true, get: () => window[key] });
}

const { mount, StrevokitMeetingElement } = await import("@strevokit/shell");
assert.equal(window.customElements.get("strevokit-meeting"), StrevokitMeetingElement);
assert.equal(typeof mount, "function");

const host = document.getElementById("host");
const handle = mount("#host", { token: TOKEN, realtimeUrl: REALTIME_URL });
assert.equal(handle.element.parentElement, host);
await until(() => showsPrejoin(host), "the pre-join screen from mount()");
assert.ok(!document.documentElement.outerHTML.includes(TOKEN), "the token is not in the markup");
handle.destroy();
assert.equal(host.children.length, 0);
console.log("jsdom: mount() renders the pre-join screen; destroy() removes it");

host.innerHTML = '<strevokit-meeting realtime-url="' + REALTIME_URL + '"></strevokit-meeting>';
const element = host.querySelector("strevokit-meeting");
element.token = TOKEN;
await until(() => showsPrejoin(element), "the pre-join screen from markup");
element.remove();
console.log("jsdom: <strevokit-meeting> in markup with the token property renders the pre-join screen");

host.innerHTML = '<strevokit-meeting token="' + TOKEN + '" realtime-url="' + REALTIME_URL + '"></strevokit-meeting>';
await host.querySelector("strevokit-meeting").updateComplete;
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(host.querySelector("strevokit-meeting").textContent.trim(), "", "a token attribute alone renders nothing");
console.log("jsdom: a token attribute alone renders nothing");
process.exit(0);
`;

const CDN_SOURCE = `${DOM_SUPPORT}
import { readFileSync } from "node:fs";

const window = page({ runScripts: "outside-only" });
window.eval(readFileSync(process.env.SHELL_CDN_FILE, "utf8"));
const global = window.StrevokitShell;
assert.match(global.version, /^\\d+\\.\\d+\\.\\d+/);
assert.equal(typeof global.mount, "function");
assert.equal(window.customElements.get("strevokit-meeting"), global.StrevokitMeetingElement);
assert.ok(Object.isFrozen(global));

global.mount("#host", { token: TOKEN, realtimeUrl: REALTIME_URL });
await until(() => showsPrejoin(window.document.getElementById("host")), "the pre-join screen from the CDN build");
console.log(\`CDN build: window.StrevokitShell \${global.version} mounts the pre-join screen\`);
process.exit(0);
`;

const run = (cmd, args, cwd, env = process.env) =>
  execFileSync(cmd, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const output = (error) => `${error.stdout ?? ""}${error.stderr ?? ""}`;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const packed = pack();
const unexpected = packed.files.filter(
  (file) => !REQUIRED_FILES.includes(file) && !OPTIONAL_FILES.includes(file) && !file.startsWith("docs/"),
);
const missing = REQUIRED_FILES.filter((file) => !packed.files.includes(file));
if (unexpected.length > 0 || missing.length > 0) {
  fail(`tarball contents wrong. unexpected: [${unexpected.join(", ")}] missing: [${missing.join(", ")}]`);
}

const { dir: extractDir, packageDir } = extract(packed.tarball);
const manifest = readJson(join(packageDir, "package.json"));
const reactImports = walk(join(packageDir, "dist"))
  .filter((path) => /\.(?:js|ts)$/.test(path))
  .filter((path) => REACT_IMPORT.test(readFileSync(path, "utf8")))
  .map((path) => relative(packageDir, path));
rmSync(extractDir, { recursive: true, force: true });

const manifestProblems = [];
const dependencies = Object.keys(manifest.dependencies ?? {});
if (JSON.stringify(dependencies) !== JSON.stringify(["lit"])) {
  manifestProblems.push(`dependencies are [${dependencies.join(", ")}]; expected [lit]`);
}
for (const field of ["peerDependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies"]) {
  if (manifest[field] && Object.keys(manifest[field]).length > 0) manifestProblems.push(`declares ${field}`);
}
for (const field of ["jsdelivr", "unpkg"]) {
  if (manifest[field]?.replace(/^\.\//, "") !== CDN_FILE) manifestProblems.push(`"${field}" does not point at ${CDN_FILE}`);
}
if (manifestProblems.length > 0) fail(`packed package.json: ${manifestProblems.join("; ")}.`);
if (reactImports.length > 0) fail(`the tarball imports React: ${reactImports.join(", ")}`);

try {
  run("npm", ["publish", "--dry-run", packed.tarball], root);
} catch (error) {
  fail(`npm publish --dry-run failed:\n${output(error)}`);
}
console.log(`npm publish --dry-run succeeded for ${packed.name}@${packed.version}`);
console.log(`dependencies: ${dependencies.join(", ")}; no React imports; tarball files: ${packed.files.join(", ")}`);

const consumer = tempDir("shell-consumer");
try {
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  try {
    run("npm", ["install", packed.tarball, "--no-audit", "--no-fund", "--ignore-scripts"], consumer);
  } catch (error) {
    fail(`installing the shell tarball failed:\n${output(error)}`);
  }
  const installed = readdirSync(join(consumer, "node_modules")).filter((name) => !name.startsWith("."));
  console.log(`clean install: node_modules has ${installed.join(", ")}`);

  writeFileSync(join(consumer, "consumer.ts"), CONSUMER_SOURCE);
  for (const moduleResolution of ["NodeNext", "Bundler"]) {
    const compilerOptions = {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: moduleResolution === "NodeNext" ? "NodeNext" : "ESNext",
      moduleResolution,
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      types: [],
      skipLibCheck: false,
    };
    writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions, files: ["consumer.ts"] }));
    try {
      run(bin("tsc"), ["-p", "tsconfig.json"], consumer);
    } catch (error) {
      fail(`consumer type-check failed (moduleResolution ${moduleResolution}):\n${output(error)}`);
    }
  }
  console.log("consumer type-check passed (NodeNext and Bundler resolution)");

  const env = {
    ...process.env,
    SHELL_PACKAGE_JSON: join(root, "package.json"),
    SHELL_CDN_FILE: join(consumer, "node_modules", "@strevokit", "shell", CDN_FILE),
  };
  const scripts = [
    ["node.mjs", NODE_SOURCE, [], "plain Node import"],
    ["dom.mjs", DOM_SOURCE, ["--conditions=browser"], "jsdom mount"],
    ["cdn.mjs", CDN_SOURCE, [], "CDN build in jsdom"],
  ];
  for (const [file, source, flags, what] of scripts) {
    writeFileSync(join(consumer, file), source);
    try {
      process.stdout.write(run(process.execPath, [...flags, file], consumer, env));
    } catch (error) {
      fail(`${what} smoke failed:\n${output(error)}`);
    }
  }
} finally {
  rmSync(consumer, { recursive: true, force: true });
}

console.log("pack smoke: ok");
