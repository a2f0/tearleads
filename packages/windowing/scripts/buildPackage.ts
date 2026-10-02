import { spawnSync } from "node:child_process";
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const repoRoot = join(packageRoot, "..", "..");

// Builds the package npm receives: compiled JavaScript with type declarations,
// the stylesheets beside the modules that import them, the README, and a
// package.json written for consumers. The workspace keeps importing src/
// (see this package's own package.json), so nothing in the repo reads the
// output and it can never go stale under another package's tests.
export async function buildPackage(outDir: string): Promise<void> {
  await rm(outDir, { force: true, recursive: true });
  run([
    process.execPath,
    "x",
    "tsc",
    "-p",
    join(packageRoot, "tsconfig.build.json"),
    "--outDir",
    outDir,
  ]);
  run([
    process.execPath,
    join(repoRoot, "scripts", "lib", "rewriteDistImports.ts"),
    outDir,
  ]);
  await copyStylesheets(join(packageRoot, "src"), outDir);
  await cp(join(packageRoot, "README.md"), join(outDir, "README.md"));
  await writeFile(
    join(outDir, "package.json"),
    `${JSON.stringify(await publishManifest(), null, 2)}\n`,
  );
}

function run(command: string[]) {
  const [executable, ...args] = command;
  if (!executable) {
    throw new Error("empty command");
  }
  const result = spawnSync(executable, args, {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} exited with ${result.status}`);
  }
}

async function copyStylesheets(sourceDir: string, outDir: string) {
  const entries = await readdir(sourceDir, { recursive: true });
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".css"))
      .map((entry) => cp(join(sourceDir, entry), join(outDir, entry))),
  );
}

interface WorkspaceManifest {
  dependencies: Record<string, string>;
  name: string;
  version: string;
}

// React is the host's, so it is a peer dependency, from 19.2 (the first with
// useEffectEvent); everything else the package imports at runtime is a
// dependency, with a caret range consumers can dedupe against.
//
// Stylesheets are side effects, and so is the entry: it exports only
// re-exports, so a bundler that trusts sideEffects (webpack) would otherwise
// route imports past it and drop its tokens.css import with it.
async function publishManifest() {
  const manifest: WorkspaceManifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const phosphor = manifest.dependencies["@phosphor-icons/react"];
  if (!phosphor) {
    throw new Error("@phosphor-icons/react is missing from dependencies");
  }

  return {
    name: manifest.name,
    version: manifest.version,
    description:
      "App-agnostic window management for React: window state, window chrome, and the menu and sidebar primitives it renders with.",
    license: "UNLICENSED",
    type: "module",
    main: "./index.js",
    types: "./index.d.ts",
    exports: {
      ".": { types: "./index.d.ts", default: "./index.js" },
      "./*.css": "./*.css",
    },
    sideEffects: ["*.css", "./index.js"],
    peerDependencies: { react: "^19.2.0", "react-dom": "^19.2.0" },
    dependencies: { "@phosphor-icons/react": `^${phosphor}` },
  };
}

if (import.meta.main) {
  const outDir = process.argv[2] ?? join(packageRoot, "dist");
  await buildPackage(outDir);
  console.log(`Built ${outDir}`);
}
