import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const runMaestroTestsScript = resolve(
  import.meta.dir,
  "../../../scripts/runMaestroTests.sh",
);

const bootedUdid = "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD";
const oldIphone16Udid = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
const iphone16ProUdid = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";
const newIphone16Udid = "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC";

const availableDevices = [
  "-- iOS 18.0 --",
  `    iPhone 16 (${oldIphone16Udid}) (Shutdown)`,
  `    iPhone 16 Pro (${iphone16ProUdid}) (Shutdown)`,
  "-- iOS 26.2 --",
  `    iPhone 16 (${newIphone16Udid}) (Shutdown)`,
].join("\n");

let shimDirectory = "";

function environmentValue(name: string) {
  return process.env[name];
}

beforeAll(async () => {
  shimDirectory = await mkdtemp(resolve(tmpdir(), "tearleads-maestro-shims-"));
  const loggingStubs = ["maestro", "bun", "bunx", "xcodebuild"];
  for (const stub of loggingStubs) {
    const stubPath = resolve(shimDirectory, stub);
    await Bun.write(
      stubPath,
      ["#!/bin/sh", `printf '${stub}:%s\\n' "$*" >> "$MAESTRO_TEST_LOG"`].join(
        "\n",
      ),
    );
    await chmod(stubPath, 0o755);
  }
  const xcrunStub = resolve(shimDirectory, "xcrun");
  await Bun.write(
    xcrunStub,
    [
      "#!/bin/sh",
      'printf \'xcrun:%s\\n\' "$*" >> "$MAESTRO_TEST_LOG"',
      'if [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$4" = "booted" ]; then',
      "  printf '%s\\n' \"$SHIM_SIMCTL_BOOTED\"",
      'elif [ "$1" = "simctl" ] && [ "$2" = "list" ] && [ "$4" = "available" ]; then',
      "  printf '%s\\n' \"$SHIM_SIMCTL_AVAILABLE\"",
      "fi",
    ].join("\n"),
  );
  await chmod(xcrunStub, 0o755);
  const adbStub = resolve(shimDirectory, "adb");
  await Bun.write(
    adbStub,
    [
      "#!/bin/sh",
      'printf \'adb:%s\\n\' "$*" >> "$MAESTRO_TEST_LOG"',
      'if [ "$1" = "devices" ]; then',
      "  printf 'List of devices attached\\n%s\\n' \"$SHIM_ADB_DEVICES\"",
      "fi",
    ].join("\n"),
  );
  await chmod(adbStub, 0o755);
});

afterAll(async () => {
  await rm(shimDirectory, { recursive: true, force: true });
});

async function runScript(options: {
  platform: string;
  booted?: string;
  adbDevices?: string;
  iosSimulator?: string;
}) {
  const logPath = resolve(
    await mkdtemp(resolve(tmpdir(), "tearleads-maestro-log-")),
    "invocations.log",
  );
  await Bun.write(logPath, "");
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${shimDirectory}:${environmentValue("PATH") ?? ""}`,
    MAESTRO_TEST_LOG: logPath,
    SHIM_SIMCTL_BOOTED: options.booted ?? "== Devices ==",
    SHIM_SIMCTL_AVAILABLE: availableDevices,
    SHIM_ADB_DEVICES: options.adbDevices ?? "",
    MAESTRO_IOS_SIMULATOR: options.iosSimulator,
  };
  const child = Bun.spawn(["sh", runMaestroTestsScript, options.platform], {
    env,
    stderr: "pipe",
    stdout: "ignore",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  const log = await Bun.file(logPath).text();
  await rm(resolve(logPath, ".."), { recursive: true, force: true });
  return { exitCode, stderr, log };
}

function maestroLines(log: string) {
  return log.split("\n").filter((line) => line.startsWith("maestro:"));
}

test("an explicit iOS selector wins over a booted simulator", async () => {
  const { exitCode, stderr, log } = await runScript({
    platform: "ios",
    booted: `    iPhone 16 (${bootedUdid}) (Booted)`,
    iosSimulator: "iPhone 16 Pro",
  });
  expect(exitCode, stderr).toBe(0);
  expect(log).toContain(`xcrun:simctl bootstatus ${iphone16ProUdid} -b`);
  expect(log).toContain(`xcrun:simctl install ${iphone16ProUdid}`);
  expect(maestroLines(log)).toEqual([
    `maestro:--platform ios --device ${iphone16ProUdid} test maestro/first-identity-offline.yaml`,
    `maestro:--platform ios --device ${iphone16ProUdid} test maestro/offline-second-identity.yaml`,
  ]);
});

test("without a selector a booted simulator is reused", async () => {
  const { exitCode, stderr, log } = await runScript({
    platform: "ios",
    booted: `    iPhone 16 (${bootedUdid}) (Booted)`,
  });
  expect(exitCode, stderr).toBe(0);
  expect(maestroLines(log)).toEqual([
    `maestro:--platform ios --device ${bootedUdid} test maestro/first-identity-offline.yaml`,
    `maestro:--platform ios --device ${bootedUdid} test maestro/offline-second-identity.yaml`,
  ]);
});

test("with nothing booted the newest iPhone 16 runtime is used", async () => {
  const { exitCode, stderr, log } = await runScript({ platform: "ios" });
  expect(exitCode, stderr).toBe(0);
  expect(log).toContain(`xcrun:simctl bootstatus ${newIphone16Udid} -b`);
  expect(maestroLines(log)).toEqual([
    `maestro:--platform ios --device ${newIphone16Udid} test maestro/first-identity-offline.yaml`,
    `maestro:--platform ios --device ${newIphone16Udid} test maestro/offline-second-identity.yaml`,
  ]);
});

test("an unknown iOS selector fails before running flows", async () => {
  const { exitCode, stderr, log } = await runScript({
    platform: "ios",
    booted: `    iPhone 16 (${bootedUdid}) (Booted)`,
    iosSimulator: "Ghost Phone",
  });
  expect(exitCode).toBe(1);
  expect(stderr).toContain("No available simulator named 'Ghost Phone'");
  expect(maestroLines(log)).toEqual([]);
});

test("android refuses to run against a physical device", async () => {
  const { exitCode, stderr, log } = await runScript({
    platform: "android",
    adbDevices: "R5CN300XYZA\tdevice",
  });
  expect(exitCode).toBe(1);
  expect(stderr).toContain("physical devices are refused");
  expect(maestroLines(log)).toEqual([]);
  expect(log).not.toContain("adb:install");
});
