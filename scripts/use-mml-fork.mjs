// Replaces the installed @mml-io MML packages with builds from a local fork of mml-io/mml.
//
// Usage (from the repository root, after `npm install` and building the fork):
//   node scripts/use-mml-fork.mjs [path-to-fork]   (default: ../upstream-mml)
//
// Afterwards run `npm run build -- --force` so the web client is rebundled with the fork's code (turbo does not
// notice changes inside node_modules, so --force is needed).
// Re-run this script after every `npm install`, which restores the published packages.
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const forkRoot = path.resolve(repoRoot, process.argv[2] ?? "../upstream-mml");

// Fork package directory -> published package name
const packages = {
  "mml-web": "@mml-io/mml-web",
  "mml-web-threejs": "@mml-io/mml-web-threejs",
  "mml-web-threejs-standalone": "@mml-io/mml-web-threejs-standalone",
  "networked-dom-web-runner": "@mml-io/networked-dom-web-runner",
  "observable-dom": "@mml-io/observable-dom",
  // Loads avatars and m-model files (the fork sets up the DRACO decoder for three r184+)
  "model-loader": "@mml-io/model-loader",
};

// Packages of the fork that the published packages do not have: installed from the fork when missing
// (mml-web depends on the deterministic physics engine of physics v3)
const forkOnlyPackages = {
  "mml-physics-core": "@mml-io/mml-physics-core",
};

let problems = 0;
for (const [dir, name] of Object.entries(packages)) {
  const source = path.join(forkRoot, "packages", dir);
  const target = path.join(repoRoot, "node_modules", ...name.split("/"));
  if (!fs.existsSync(path.join(source, "build"))) {
    console.error(`missing build for ${dir} in ${source}. Build the fork first.`);
    problems++;
    continue;
  }
  if (!fs.existsSync(target)) {
    console.log(`skip ${name}: not installed here`);
    continue;
  }
  const forkPkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  const installedPkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  const forkDeps = JSON.stringify(forkPkg.dependencies ?? {});
  const installedDeps = JSON.stringify(installedPkg.dependencies ?? {});
  if (forkDeps !== installedDeps) {
    console.warn(`warning: ${name} dependencies differ between fork and installed package`);
    console.warn(`  fork:      ${forkDeps}`);
    console.warn(`  installed: ${installedDeps}`);
  }
  fs.rmSync(path.join(target, "build"), { recursive: true, force: true });
  fs.cpSync(path.join(source, "build"), path.join(target, "build"), { recursive: true });
  console.log(`${name} <- ${path.relative(repoRoot, source)}`);
}
for (const [dir, name] of Object.entries(forkOnlyPackages)) {
  const source = path.join(forkRoot, "packages", dir);
  const target = path.join(repoRoot, "node_modules", ...name.split("/"));
  if (!fs.existsSync(path.join(source, "build"))) {
    console.error(`missing build for ${dir} in ${source}. Build the fork first.`);
    problems++;
    continue;
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(source, "package.json"), path.join(target, "package.json"));
  fs.cpSync(path.join(source, "build"), path.join(target, "build"), { recursive: true });
  console.log(`${name} <- ${path.relative(repoRoot, source)} (installed from the fork)`);
}
process.exit(problems ? 1 : 0);
