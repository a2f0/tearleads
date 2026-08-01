import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const screenshotScript = resolve(
  import.meta.dir,
  "../../../scripts/takeSubscriptionReviewScreenshots.sh",
);
const reviewFlow = resolve(
  import.meta.dir,
  "../maestro/review/subscription-review-screenshots.yaml",
);
const verificationFlow = resolve(
  import.meta.dir,
  "../maestro/review/subscription-review-catalog-visible.yaml",
);
const runtimeIdentifier = "com.apple.CoreSimulator.SimRuntime.iOS-18-0";
const deviceTypeIdentifier = "com.apple.CoreSimulator.SimDeviceType.iPhone-16";
const dedicatedDeviceName = "Tearleads Subscription Review";
const dedicatedUdid = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
const unrelatedUdid = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";

const runtimesJson = JSON.stringify({
  runtimes: [
    {
      identifier: runtimeIdentifier,
      isAvailable: true,
      supportedDeviceTypes: [{ identifier: deviceTypeIdentifier }],
      version: "18.0",
    },
  ],
});

function devicesJson(devices: Array<Record<string, unknown>>) {
  return JSON.stringify({ devices: { [runtimeIdentifier]: devices } });
}

const dedicatedDevice = {
  deviceTypeIdentifier,
  isAvailable: true,
  name: dedicatedDeviceName,
  state: "Shutdown",
  udid: dedicatedUdid,
};

let shimDirectory = "";

function environmentValue(name: string) {
  return process.env[name];
}

beforeAll(async () => {
  shimDirectory = await mkdtemp(
    resolve(tmpdir(), "tearleads-subscription-review-shims-"),
  );
  for (const command of ["bun", "bunx", "maestro", "open", "xcodebuild"]) {
    const path = resolve(shimDirectory, command);
    await Bun.write(
      path,
      [
        "#!/bin/sh",
        `printf '${command}:%s\\n' "$*" >> "$SUBSCRIPTION_REVIEW_TEST_LOG"`,
      ].join("\n"),
    );
    await chmod(path, 0o755);
  }

  const xcrunPath = resolve(shimDirectory, "xcrun");
  await Bun.write(
    xcrunPath,
    [
      "#!/bin/sh",
      'printf \'xcrun:%s\\n\' "$*" >> "$SUBSCRIPTION_REVIEW_TEST_LOG"',
      'if [ "$1 $2 $3 $4 $5" = "simctl list runtimes available -j" ]; then',
      "  printf '%s\\n' \"$SHIM_RUNTIMES_JSON\"",
      'elif [ "$1 $2 $3 $4 $5" = "simctl list devices available -j" ]; then',
      '  if [ -f "$SHIM_CREATED_FILE" ]; then',
      "    printf '%s\\n' \"$SHIM_CREATED_DEVICES_JSON\"",
      "  else",
      "    printf '%s\\n' \"$SHIM_INITIAL_DEVICES_JSON\"",
      "  fi",
      'elif [ "$1 $2" = "simctl create" ]; then',
      '  : > "$SHIM_CREATED_FILE"',
      "  printf '%s\\n' \"$SHIM_CREATED_UDID\"",
      'elif [ "$1 $2 $4" = "simctl io screenshot" ]; then',
      '  printf image > "$7"',
      "fi",
    ].join("\n"),
  );
  await chmod(xcrunPath, 0o755);

  const sipsPath = resolve(shimDirectory, "sips");
  await Bun.write(
    sipsPath,
    [
      "#!/bin/sh",
      "printf 'pixelWidth: 1179\\npixelHeight: 2556\\nhasAlpha: no\\n'",
    ].join("\n"),
  );
  await chmod(sipsPath, 0o755);
});

afterAll(async () => {
  await rm(shimDirectory, { force: true, recursive: true });
});

async function runScript(options: {
  apiBaseUrl?: string;
  apiKey?: string;
  initialDevices?: Array<Record<string, unknown>>;
  selectedUdid?: string;
}) {
  const testDirectory = await mkdtemp(
    resolve(tmpdir(), "tearleads-subscription-review-test-"),
  );
  const logPath = resolve(testDirectory, "invocations.log");
  const outputDirectory = resolve(testDirectory, "screenshots");
  const createdFile = resolve(testDirectory, "created");
  await Bun.write(logPath, "");
  const env: Record<string, string | undefined> = {
    ...process.env,
    IOS_SCREENSHOT_DEVICE_UDID: options.selectedUdid,
    IOS_SCREENSHOT_RUNTIME_VERSION: "18.0",
    PATH: `${shimDirectory}:${environmentValue("PATH") ?? ""}`,
    SHIM_CREATED_DEVICES_JSON: devicesJson([dedicatedDevice]),
    SHIM_CREATED_FILE: createdFile,
    SHIM_CREATED_UDID: dedicatedUdid,
    SHIM_INITIAL_DEVICES_JSON: devicesJson(options.initialDevices ?? []),
    SHIM_RUNTIMES_JSON: runtimesJson,
    SUBSCRIPTION_REVIEW_TEST_LOG: logPath,
    SUBSCRIPTION_SCREENSHOT_REVENUECAT_ENV_FILE: resolve(
      testDirectory,
      "missing.env",
    ),
    SUBSCRIPTION_SCREENSHOT_OUTPUT_DIR: outputDirectory,
    TMPDIR: testDirectory,
    VITE_API_BASE_URL: options.apiBaseUrl ?? "https://api.tearleads.com",
    VITE_REVENUECAT_IOS_API_KEY: options.apiKey ?? "appl_production",
  };
  const child = Bun.spawn(["sh", screenshotScript], {
    cwd: testDirectory,
    env,
    stderr: "pipe",
    stdout: "ignore",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  const log = await Bun.file(logPath).text();
  const screenshots = await Promise.all(
    [
      "subscription-solo.png",
      "subscription-team-5.png",
      "subscription-team-10.png",
    ].map((name) => Bun.file(resolve(outputDirectory, name)).exists()),
  );
  await rm(testDirectory, { force: true, recursive: true });
  return { exitCode, log, outputDirectory, screenshots, stderr };
}

test("creates and targets a dedicated iPhone 16 simulator", async () => {
  const result = await runScript({});

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.log).toContain(
    `xcrun:simctl create ${dedicatedDeviceName} ${deviceTypeIdentifier} ${runtimeIdentifier}`,
  );
  expect(result.log).toContain(`xcrun:simctl boot ${dedicatedUdid}`);
  expect(
    result.log.split("\n").filter((line) => line.startsWith("maestro:")),
  ).toEqual([
    `maestro:--platform ios --device ${dedicatedUdid} test --test-output-dir ${resolve(result.outputDirectory, "maestro")} ${reviewFlow}`,
    `maestro:--platform ios --device ${dedicatedUdid} test --test-output-dir ${resolve(result.outputDirectory, "maestro")} ${verificationFlow}`,
  ]);
  expect(result.screenshots).toEqual([true, true, true]);
});

test("reuses the existing dedicated simulator", async () => {
  const result = await runScript({ initialDevices: [dedicatedDevice] });

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.log).not.toContain("xcrun:simctl create");
  expect(result.log).toContain(`xcrun:simctl install ${dedicatedUdid}`);
});

test("rejects a RevenueCat Test Store key before simulator mutation", async () => {
  const result = await runScript({ apiKey: "test_example" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    "VITE_REVENUECAT_IOS_API_KEY is not a RevenueCat platform public SDK key",
  );
  expect(result.log).not.toContain("xcrun:");
  expect(result.log).not.toContain("bun:");
});

test("rejects a dev API URL before simulator mutation", async () => {
  const result = await runScript({ apiBaseUrl: "http://localhost:3001" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    "VITE_API_BASE_URL=http://localhost:3001 points at a dev-only host",
  );
  expect(result.log).not.toContain("xcrun:");
  expect(result.log).not.toContain("bun:");
});

test("rejects an unrelated simulator override", async () => {
  const result = await runScript({
    initialDevices: [
      {
        ...dedicatedDevice,
        name: "iPhone 16",
        udid: unrelatedUdid,
      },
    ],
    selectedUdid: unrelatedUdid,
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    "The selected simulator must be the dedicated iPhone 16",
  );
  expect(result.log).not.toContain("bun:");
});
