import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  orgAuthToken,
  privateTempBase,
  startFakeSentry,
} from "./sentrySourceMapUpload.testUtils";
import {
  applyHostileMap,
  bundleFiles,
  type HostileMapVector,
  hostileMapVectors,
  plantCanary,
  repositoryRelativeSources,
  sha256,
  stagedDigests,
} from "./sentryStagedMaps.testUtils";

// The upload arguments alone, without the staging checks: the pinned sentry-cli
// run as the release runs it, over a staged dist whose renderer pair points at
// a host file outside staging.
const harness = `import { resolveSentryCliBinary, runSentryCli } from ${JSON.stringify(join(import.meta.dirname, "sentryCliUpload.ts"))};
import { desktopSourceMapUploadArgs } from ${JSON.stringify(join(import.meta.dirname, "sentrySourceMaps.ts"))};
const [intended, token, directory] = process.argv.slice(2);
const url = new URL(intended).origin + "/";
process.exit(await runSentryCli({
  binary: resolveSentryCliBinary(), token,
  endpoint: { url, isAllowed: (candidate) => candidate.href === url },
  args: desktopSourceMapUploadArgs({ org: "test-org", project: "p", release: "r", dist: "d", directory }),
}));
`;

async function stage(root: string, dist: string) {
  for (const [entry, naming, target, source] of [
    ["renderer.ts", "chunk-a1b2c3.js", "browser", "document.title"],
    ["main.ts", "bun/index.js", "bun", "process.pid"],
  ] as const) {
    await Bun.write(
      join(root, "sources", entry),
      `export const value = () => ${source};\nconsole.log(value());\n`,
    );
    const build = await Bun.build({
      entrypoints: [join(root, "sources", entry)],
      outdir: dist,
      naming,
      target,
      sourcemap: "external",
    });
    if (!build.success) throw new AggregateError(build.logs);
    await repositoryRelativeSources(join(dist, `${naming}.map`), root);
  }
}

const { PATH = "" } = process.env;

async function uploadStaged(vector: HostileMapVector | "none") {
  const base = await privateTempBase();
  const root = await realpath(await mkdtemp(join(base, "cli-isolation-")));
  const tmp = await realpath(await mkdtemp(join(base, "cli-isolation-tmp-")));
  const bundlePath = join(root, "bundle.zip");
  const intended = startFakeSentry(bundlePath, false);
  try {
    const dist = join(root, "staging/staging-app-macos-arm64");
    await stage(root, dist);
    const canary = await plantCanary(join(root, "host"));
    if (vector !== "none")
      await applyHostileMap({
        script: join(dist, "chunk-a1b2c3.js"),
        vector,
        canary: canary.path,
        tmp,
      });
    const staged = await stagedDigests(dist);
    await Bun.write(join(root, "harness.ts"), harness);
    const child = Bun.spawn(
      [
        process.execPath,
        join(root, "harness.ts"),
        intended.url,
        orgAuthToken(intended.url),
        dist,
      ],
      {
        cwd: root,
        env: { PATH, HOME: root, TMPDIR: tmp },
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
      staged,
      canary: canary.bytes,
      raw: await readFile(bundlePath),
      files: bundleFiles(bundlePath),
    };
  } finally {
    intended.stop();
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  }
}

test.each<HostileMapVector | "none">(["none", ...hostileMapVectors])(
  "sentry-cli uploads only the staged files' own bytes when the renderer pair has %s pointing outside staging",
  async (vector) => {
    const run = await uploadStaged(vector);
    expect(run.code, run.output).toBe(0);
    for (const bytes of [run.raw, ...Object.values(run.files)])
      expect(bytes.includes(run.canary)).toBe(false);
    expect(run.output).not.toContain(run.canary);
    const { "manifest.json": manifest, ...uploaded } = run.files;
    expect(manifest).toBeDefined();
    expect(
      Object.fromEntries(
        Object.entries(uploaded).map(([path, bytes]) => [path, sha256(bytes)]),
      ),
    ).toEqual(run.staged);
  },
  60000,
);
