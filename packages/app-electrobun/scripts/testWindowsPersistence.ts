import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

if (process.platform !== "win32") {
  throw new Error("The Electrobun persistence smoke test requires Windows.");
}

const packageDir = resolve(import.meta.dir, "..");
const devtoolsUrl = "http://127.0.0.1:9222/json";
const occupied = await fetch(devtoolsUrl, {
  signal: AbortSignal.timeout(1_000),
}).then(
  () => true,
  () => false,
);
if (occupied) throw new Error("CEF DevTools port 9222 is already in use.");

const smokeRoot = await mkdtemp(join(tmpdir(), "tearleads-cef-persistence-"));
const localAppData = join(smokeRoot, "local");
const firstState = join(smokeRoot, "first-state.json");
const environment = {
  ...process.env,
  NODE_ENV: "development",
  LOCALAPPDATA: localAppData,
  TEARLEADS_ELECTROBUN_PACKAGE_DIR: packageDir,
  ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: "9222",
};

async function buildApp(): Promise<string> {
  const build = Bun.spawn(["sh", "scripts/runElectronbun.sh", "build:dev"], {
    cwd: packageDir,
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await build.exited) !== 0) throw new Error("Windows build failed.");

  const buildDir = join(packageDir, "build", `dev-win-${process.arch}`);
  const metadataFiles = Array.from(
    new Bun.Glob("**/build.json").scanSync({ cwd: buildDir, absolute: true }),
  );
  const [metadataPath] = metadataFiles;
  if (metadataFiles.length !== 1 || !metadataPath) {
    throw new Error("Expected one Windows app build.json.");
  }
  const metadata = await Bun.file(metadataPath).json();
  if (
    metadata.defaultRenderer !== "cef" ||
    !metadata.availableRenderers?.includes("cef")
  ) {
    throw new Error("The Windows build did not bundle and select CEF.");
  }
  return join(dirname(dirname(metadataPath)), "bin", "launcher.exe");
}

async function runRound(
  mode: "first" | "reopen",
  launcherPath: string,
): Promise<void> {
  const logPath = join(smokeRoot, `${mode}.log`);
  const logFd = openSync(logPath, "w");
  // Launch the completed bundle. `electrobun dev` rebuilds it and bypasses
  // packageElectrobunAssets.ts, which supplies the packaged SQLite assets.
  const app = Bun.spawn([launcherPath], {
    cwd: dirname(launcherPath),
    env: { ...environment, NODE_ENV: "production" },
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
  });
  closeSync(logFd);

  let roundError: unknown = null;
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (app.exitCode !== null)
        throw new Error("Electrobun exited at startup.");
      ready = await fetch(devtoolsUrl, {
        signal: AbortSignal.timeout(1_000),
      }).then(
        (response) => response.ok,
        () => false,
      );
      if (ready) break;
      await Bun.sleep(200);
    }
    if (!ready) throw new Error("Timed out waiting for CEF DevTools.");
    const log = await Bun.file(logPath).text();
    if (!log.includes("[CEF] Remote debugging enabled on 127.0.0.1:9222")) {
      throw new Error("The Windows app did not launch the CEF renderer.");
    }

    const probe = Bun.spawn(
      [process.execPath, "scripts/probeCefPersistence.ts", mode, firstState],
      { cwd: packageDir, stdout: "pipe", stderr: "inherit" },
    );
    const output = await new Response(probe.stdout).text();
    if ((await probe.exited) !== 0) throw new Error(`${mode} probe failed.`);
    if (mode === "first") await Bun.write(firstState, output);
    else process.stdout.write(output);
  } catch (error) {
    process.stderr.write(await Bun.file(logPath).text());
    roundError = error;
  }
  if (app.exitCode === null) {
    // Without /F, taskkill requests a normal window close so CEF can flush
    // localStorage and shut down before the second launch reads that profile.
    const close = Bun.spawn(["taskkill", "/PID", String(app.pid), "/T"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await close.exited;
    const deadline = Date.now() + 15_000;
    while (app.exitCode === null && Date.now() < deadline) {
      await Bun.sleep(100);
    }
    if (app.exitCode === null) {
      const force = Bun.spawn(
        ["taskkill", "/PID", String(app.pid), "/T", "/F"],
        { stdout: "ignore", stderr: "inherit" },
      );
      await force.exited;
      await app.exited;
      throw new Error("Windows app did not exit after a graceful close.");
    }
  }
  await app.exited;
  if (roundError !== null) throw roundError;
}

try {
  await mkdir(localAppData);
  const launcherPath = await buildApp();
  await runRound("first", launcherPath);
  await runRound("reopen", launcherPath);
  console.log("Electrobun Windows CEF persistence smoke test passed.");
} finally {
  await rm(smokeRoot, { recursive: true, force: true, maxRetries: 5 });
}
