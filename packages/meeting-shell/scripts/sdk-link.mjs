// Places the meeting SDK in node_modules for bundling without saving it to package.json or the lockfile. By default
// it builds and packs the sibling ../meeting-sdk source; with --published it packs the registry version matching the
// `strevokitSdk` range in package.json. The SDK is bundled into both builds and is never a dependency of the package,
// so the tarball is unpacked directly rather than installed. The SDK has no runtime dependencies, so unpacking is
// equivalent to installing it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fail, readJson, root } from "./lib.mjs";

const NAME = "@strevokit/meeting-sdk";
const published = process.argv.includes("--published");
const sdk = join(root, "..", "meeting-sdk");
const destination = join(root, "build", "sdk-pack");

const run = (args, cwd) => execFileSync("npm", args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });

let source;
let spec;
if (published) {
  const range = readJson(join(root, "package.json")).strevokitSdk;
  if (typeof range !== "string" || range === "") fail("package.json has no strevokitSdk range for the bundled SDK.");
  source = "the registry";
  spec = `${NAME}@${range}`;
} else {
  if (!existsSync(join(sdk, "package.json"))) {
    fail("The meeting SDK source is not next to this package; run `npm run sdk:install` instead.");
  }
  source = "the local source";
  spec = ".";
  run(["run", "protocol:build"], sdk);
  run(["ci", "--no-audit", "--no-fund"], sdk);
  run(["run", "build"], sdk);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
const [info] = JSON.parse(run(["pack", "--json", "--pack-destination", destination, spec], published ? root : sdk));
const target = join(root, "node_modules", ...NAME.split("/"));
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
execFileSync("tar", ["-xzf", join(destination, info.filename), "-C", target, "--strip-components=1"], { stdio: "inherit" });
console.log(`sdk:link: installed ${info.name}@${info.version} from ${source}`);
