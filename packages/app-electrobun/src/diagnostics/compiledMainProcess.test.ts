import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const secret = "SYNTHETIC_PRIVATE_MAIN_PROCESS_VALUE";
const commit = "b".repeat(40);
const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;

interface MainProcessRun {
  stdout: string;
  build: string;
  deployed: string;
}

// Builds the fixture the way Electrobun ships the main process, deploys only
// the bundle into an install path with a literal %20, and runs it in a Worker
// as the Electrobun launcher does.
async function runPackagedMainProcess(options: {
  define: boolean;
  keepMap: boolean;
  env?: Record<string, string>;
}): Promise<MainProcessRun> {
  const directory = await mkdtemp(join(tmpdir(), "electrobun-main-"));
  const build = join(directory, "build");
  const deployed = join(directory, "deployed");
  try {
    await Bun.write(
      join(directory, "fixture.ts"),
      `
import { configureMainProcessDiagnostics } from ${JSON.stringify(join(import.meta.dirname, "mainProcess.ts"))};
globalThis.fetch = async (_url, init) => { console.log(String(init?.body)); return new Response(null, { status: 200 }); };
process.on("uncaughtException", () => { console.log("SHUTDOWN"); process.exit(1); });
console.log(\`CONFIGURED \${Boolean(configureMainProcessDiagnostics(import.meta.url))}\`);
setTimeout(() => { void (async () => { throw new RangeError(${JSON.stringify(secret)}); })(); }, 1);
setTimeout(() => { [1].map(() => { throw new TypeError(${JSON.stringify(secret)}); }); }, 80);
setTimeout(() => process.exit(3), 6000);
`,
    );
    await Bun.write(
      join(directory, "host.ts"),
      `const worker = new Worker(process.argv[2]);
worker.addEventListener("close", (event) => process.exit(event.code));
`,
    );
    const define = options.define
      ? {
          TEARLEADS_ELECTROBUN_MAIN_SENTRY: JSON.stringify({
            dsn,
            environment: "staging",
            commit,
          }),
        }
      : {};
    // Each bundle builds in its own process, as the diagnostics executable test
    // does: repeated in-process builds of one module graph are not isolated.
    await Bun.write(
      join(directory, "build.ts"),
      `
const result = await Bun.build({
  entrypoints: [${JSON.stringify(join(directory, "fixture.ts"))}],
  target: "bun", outdir: ${JSON.stringify(join(build, "app/bun"))}, naming: "index.js",
  sourcemap: "external", define: ${JSON.stringify(define)},
});
if (!result.success) process.exit(1);
`,
    );
    const bundler = Bun.spawn([process.execPath, join(directory, "build.ts")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await bundler.exited).toBe(0);
    const bunDir = join(deployed, "a%20b/Contents/Resources/app/bun");
    await mkdir(bunDir, { recursive: true });
    const files = options.keepMap ? ["index.js", "index.js.map"] : ["index.js"];
    for (const file of files)
      await copyFile(join(build, "app/bun", file), join(bunDir, file));
    await rm(build, { recursive: true, force: true });
    const { PATH } = process.env;
    const run = Bun.spawn(
      [process.execPath, join(directory, "host.ts"), join(bunDir, "index.js")],
      {
        cwd: deployed,
        env: { ...(PATH ? { PATH } : {}), ...options.env },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout] = await Promise.all([
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
      run.exited,
    ]);
    return { stdout, build, deployed };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function parseEnvelopes(stdout: string) {
  const lines = stdout.trim().split("\n");
  expect(lines[0]).toBe("CONFIGURED true");
  expect(lines.at(-1)).toBe("SHUTDOWN");
  const envelopeLines = lines.slice(1, -1);
  expect(envelopeLines).toHaveLength(6);
  return [2, 5].map((index) => JSON.parse(envelopeLines[index] ?? "{}"));
}

function expectPrivate(run: MainProcessRun) {
  for (const value of [secret, run.build, run.deployed, tmpdir()])
    expect(run.stdout).not.toContain(value);
}

test("the packaged main process reports rejections and crashes with bundle-only frames before Electrobun shuts down", async () => {
  const run = await runPackagedMainProcess({ define: true, keepMap: false });
  const events = parseEnvelopes(run.stdout);
  expect(events.map((event) => event.tags.diagnostic_source)).toEqual([
    "unhandled-rejection",
    "unhandled-error",
  ]);
  for (const event of events) {
    expect(event.exception.values[0].mechanism.handled).toBe(false);
    expect(event.tags.area).toBe("electrobun-main");
    expect(event.dist).toBe("staging-app");
    expect(event.release).toBe(`tearleads-electrobun@${commit}`);
    expect(event.breadcrumbs).toEqual([]);
    const frames = event.exception.values[0].stacktrace?.frames ?? [];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames)
      expect(frame).toEqual({
        filename: "app:///bun/index.js",
        lineno: frame.lineno,
        colno: frame.colno,
        in_app: true,
      });
  }
  expectPrivate(run);
}, 60000);

test("a map left beside the bundle yields no frames and no paths", async () => {
  const run = await runPackagedMainProcess({ define: true, keepMap: true });
  for (const event of parseEnvelopes(run.stdout))
    expect(event.exception.values[0].stacktrace).toBeUndefined();
  expectPrivate(run);
}, 60000);

test("without the build define, ambient environment cannot enable reporting", async () => {
  const run = await runPackagedMainProcess({
    define: false,
    keepMap: false,
    env: {
      BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: dsn,
      BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: "staging",
      BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT: commit,
    },
  });
  // Without a rejection listener the fixture's Worker stops at the rejection,
  // so only the configuration marker is certain.
  expect(run.stdout.trim().split("\n")[0]).toBe("CONFIGURED false");
  expect(run.stdout).not.toContain('{"type":"event"}');
}, 60000);
