import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  createRepository,
  git,
  type HostileUrls,
  plantHostileConfig,
  privateTempBase,
} from "./sentrySourceMapUpload.testUtils";

export type LinuxUploadCase =
  | "clean"
  | "dirty"
  | "otherCommit"
  | "linkedMap"
  | "foreignBundle"
  | "otherTarget"
  | "foreignTargetBundle"
  | "macosTarget"
  | "relativeDir"
  | "launch";

export const linuxUploadHarness = (
  entry: string,
) => `import { runLinuxSourceMapUpload } from ${JSON.stringify(entry)};
const [intended, repoRoot, tier, target, commit, stagingDir] = process.argv.slice(2);
const root = new URL(intended).origin + "/";
try {
  await runLinuxSourceMapUpload({
    repoRoot, tier, target, commit, stagingDir, env: process.env,
    endpoint: { url: root, isAllowed: (url) => url.href === root },
  });
} catch (error) {
  console.error(String(error));
  process.exit(1);
}
`;

// What the container leaves in staging: the renderer chunk and main-process
// bundle with external maps under the build's dist, the bundle naming the
// commit and target it was built for.
async function stage(root: string, commit: string, kind: LinuxUploadCase) {
  const stagingDir = join(root, "copied/sentry-sourcemaps");
  const release = kind === "foreignBundle" ? "f".repeat(40) : commit;
  const arm = kind === "otherTarget" || kind === "foreignTargetBundle";
  const target = arm ? "linux-arm64" : "linux-x64";
  const dist = `staging-app-${kind === "otherTarget" ? target : "linux-x64"}`;
  await Bun.write(
    join(root, "sources/main.ts"),
    `export const release = ${JSON.stringify(release)};\nexport const target = ${JSON.stringify(target)};\nconsole.log(release, target);\n`,
  );
  await Bun.write(
    join(root, "sources/renderer.ts"),
    "export const render = () => document.title;\nconsole.log(render());\n",
  );
  for (const [entry, naming, target] of [
    ["renderer.ts", "chunk-a1b2c3.js", "browser"],
    ["main.ts", "bun/index.js", "bun"],
  ] as const) {
    const build = await Bun.build({
      entrypoints: [join(root, "sources", entry)],
      outdir: join(stagingDir, dist),
      naming,
      target,
      sourcemap: "external",
    });
    if (!build.success) throw new AggregateError(build.logs);
  }
  if (kind === "linkedMap") {
    await rm(join(stagingDir, dist, "chunk-a1b2c3.js.map"));
    await symlink(
      join(root, "repo/.secrets/root.env"),
      join(stagingDir, dist, "chunk-a1b2c3.js.map"),
    );
  }
  return stagingDir;
}

// Runs uploadLinuxSourceMaps.ts's flow in a Bun subprocess whose cwd, HOME,
// environment, PATH and ancestors carry hostile Sentry settings, over a clean
// checkout of a committed fixture and a staged copy of the container's maps.
export async function runHostileLinuxUpload(
  options: HostileUrls & { token: string; kind?: LinuxUploadCase },
) {
  const kind = options.kind ?? "clean";
  const base = await privateTempBase();
  const root = await realpath(await mkdtemp(join(base, "linux-upload-")));
  const tmp = await realpath(await mkdtemp(join(base, "linux-upload-tmp-")));
  try {
    const env = await plantHostileConfig(root, options);
    const repoRoot = join(root, "repo");
    await createRepository(repoRoot, options.token);
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const stagingDir = await stage(root, head, kind);
    if (kind === "dirty") await Bun.write(join(repoRoot, "bunfig.toml"), "");
    if (kind === "otherCommit") {
      await Bun.write(join(repoRoot, "next.ts"), "export {};\n");
      git(repoRoot, "add", ".");
      git(repoRoot, "commit", "--quiet", "-m", "Next");
    }
    const entry = join(import.meta.dirname, "uploadLinuxSourceMaps.ts");
    await Bun.write(join(root, "harness.ts"), linuxUploadHarness(entry));
    await Bun.write(join(root, "preload.ts"), "export {};\n");
    const child = Bun.spawn(
      [
        process.execPath,
        join(root, "harness.ts"),
        options.intended,
        repoRoot,
        "staging",
        kind === "macosTarget" ? "macos-arm64" : "linux-x64",
        head,
        kind === "relativeDir" ? "copied/sentry-sourcemaps" : stagingDir,
      ],
      {
        cwd: join(root, "work"),
        env: {
          ...env,
          ...(kind === "launch"
            ? { BUN_INSPECT_PRELOAD: join(root, "preload.ts") }
            : {}),
          TMPDIR: tmp,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return {
      code,
      output: stdout + stderr,
      head,
      staged: existsSync(stagingDir),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  }
}
