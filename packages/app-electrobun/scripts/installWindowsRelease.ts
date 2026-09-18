import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { windowsReleaseNames } from "./windowsReleaseArtifacts";

export async function installWindowsRelease(options: {
  tier: string;
  packageDir: string;
  smokeRoot: string;
  environment: NodeJS.ProcessEnv;
}): Promise<string> {
  const { tier, packageDir, smokeRoot, environment } = options;
  const names = windowsReleaseNames(tier);
  const setup = join(smokeRoot, "setup");
  await mkdir(setup);
  execFileSync(join("C:/Windows/System32", "tar.exe"), [
    "-xf",
    join(packageDir, "build/artifacts", names.installer),
    "-C",
    setup,
  ]);
  const executable =
    tier === "staging" ? "Tearleads-Setup-canary.exe" : "Tearleads-Setup.exe";
  const installer = Bun.spawn([join(setup, executable)], {
    cwd: setup,
    env: environment,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const deadline = Date.now() + 600_000;
  while (installer.exitCode === null && Date.now() < deadline)
    await Bun.sleep(200);
  if (installer.exitCode === null) {
    await Bun.spawn(["taskkill", "/PID", String(installer.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "inherit",
    }).exited;
    throw new Error("Windows installer timed out");
  }
  if ((await installer.exited) !== 0)
    throw new Error("Windows installer failed");
  const installed = join(
    smokeRoot,
    "local/com.tearleads.app",
    names.channel,
    "app",
  );
  const launcher = join(installed, "bin/launcher.exe");
  if (!(await Bun.file(launcher).exists()))
    throw new Error("Windows installer did not install the launcher");
  const version = await Bun.file(
    join(installed, "Resources/version.json"),
  ).json();
  const update = await Bun.file(
    join(packageDir, "build/artifacts", names.update),
  ).json();
  if (version.hash !== update.hash)
    throw new Error("Installed Windows app has the wrong release hash");
  // Setup auto-launches the app. Close that instance before the persistence
  // harness reopens the installed launcher twice on its fixed DevTools port.
  const close = Bun.spawn(
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(packageDir, "scripts/stopWindowsInstalledApp.ps1"),
      "-AppDirectory",
      installed,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await close.exited) !== 0)
    throw new Error("Could not close the app launched by Windows setup");
  return launcher;
}
