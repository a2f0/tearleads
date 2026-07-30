import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const packageRoot = resolve(repositoryRoot, "packages/app-capacitor");
const nativeReleaseTargetPath = resolve(
  packageRoot,
  "fastlane/native_release_target.rb",
);
const snapshotScriptPath = resolve(
  packageRoot,
  "tests/native_release_snapshot.rb",
);

interface NativeReleaseSnapshot {
  androidBuildVariant: string;
  appIdentifier: string;
  disallowedIosStoreKey: string | null;
  environment: Record<string, string | null>;
  iosConfiguration: string;
  iosScheme: string;
}

const stagingTarget = {
  androidBuildVariant: "staging",
  appIdentifier: "com.tearleads.app.staging",
  iosConfiguration: "Release-Staging",
  iosScheme: "App-Staging",
};

async function readNativeReleaseEnvironment(
  rootEnv: string,
  stagingEnv: string,
  processEnvironment: Record<string, string> = {},
  tier: string | null = "staging",
) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "tearleads-native-release-target-"),
  );
  const copiedTargetPath = join(
    temporaryRoot,
    "packages/app-capacitor/fastlane/native_release_target.rb",
  );
  const secretsDirectory = join(temporaryRoot, ".secrets");
  await mkdir(resolve(copiedTargetPath, ".."), { recursive: true });
  await mkdir(secretsDirectory, { recursive: true });
  await Promise.all([
    Bun.write(copiedTargetPath, Bun.file(nativeReleaseTargetPath)),
    Bun.write(join(secretsDirectory, "root.env"), rootEnv),
    Bun.write(join(secretsDirectory, "staging.env"), stagingEnv),
  ]);

  const environment = { ...process.env };
  for (const name of [
    "DEEPSEEK_API_KEY",
    "NATIVE_RELEASE_TIER",
    "NATIVE_TEST_VALUE",
    "VITE_REVENUECAT_ANDROID_API_KEY",
    "VITE_REVENUECAT_IOS_API_KEY",
    "VITE_REVENUECAT_SYNC_ENTITLEMENT",
    "VITE_WS_URL",
  ]) {
    Reflect.deleteProperty(environment, name);
  }
  Object.assign(environment, processEnvironment);
  if (tier !== null) {
    Object.assign(environment, { NATIVE_RELEASE_TIER: tier });
  }

  try {
    const child = Bun.spawn(
      ["bundle", "exec", "ruby", snapshotScriptPath, copiedTargetPath],
      {
        cwd: packageRoot,
        env: environment,
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(`Ruby native release target failed: ${stderr}`);
    }
    return JSON.parse(stdout) as NativeReleaseSnapshot;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

describe("native release environments", () => {
  test("staging imports only its allowlisted native client settings", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nVITE_REVENUECAT_SYNC_ENTITLEMENT=sync\nVITE_WS_URL=wss://production.example\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nVITE_REVENUECAT_ANDROID_API_KEY=goog_staging\nVITE_WS_URL=wss://staging.example\nNATIVE_TEST_VALUE=staging\nDEEPSEEK_API_KEY=server-secret\n",
    );

    expect(snapshot).toEqual({
      ...stagingTarget,
      disallowedIosStoreKey: "appl_root",
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: "root",
        VITE_REVENUECAT_ANDROID_API_KEY: "goog_staging",
        VITE_REVENUECAT_IOS_API_KEY: "appl_staging",
        VITE_REVENUECAT_SYNC_ENTITLEMENT: "sync",
        VITE_WS_URL: null,
      },
    });
  });

  test("explicit native release environment values beat dotenv files", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nVITE_REVENUECAT_ANDROID_API_KEY=goog_staging\nNATIVE_TEST_VALUE=staging\n",
      {
        NATIVE_TEST_VALUE: "process",
        VITE_REVENUECAT_IOS_API_KEY: "appl_process",
        VITE_WS_URL: "wss://process.example",
      },
    );

    expect(snapshot).toEqual({
      ...stagingTarget,
      disallowedIosStoreKey: "appl_root",
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: "process",
        VITE_REVENUECAT_ANDROID_API_KEY: "goog_staging",
        VITE_REVENUECAT_IOS_API_KEY: "appl_process",
        VITE_REVENUECAT_SYNC_ENTITLEMENT: null,
        VITE_WS_URL: "wss://process.example",
      },
    });
  });

  test("staging drops production platform keys when staging omits them", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nNATIVE_TEST_VALUE=root\n",
      "NATIVE_TEST_VALUE=staging\n",
    );

    expect(snapshot).toEqual({
      ...stagingTarget,
      disallowedIosStoreKey: "appl_root",
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: "root",
        VITE_REVENUECAT_ANDROID_API_KEY: null,
        VITE_REVENUECAT_IOS_API_KEY: null,
        VITE_REVENUECAT_SYNC_ENTITLEMENT: null,
        VITE_WS_URL: null,
      },
    });
  });

  test("staging can override the shared RevenueCat entitlement", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_SYNC_ENTITLEMENT=production-sync\n",
      "VITE_REVENUECAT_SYNC_ENTITLEMENT=staging-sync\n",
    );

    expect(snapshot).toEqual({
      ...stagingTarget,
      disallowedIosStoreKey: null,
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: null,
        VITE_REVENUECAT_ANDROID_API_KEY: null,
        VITE_REVENUECAT_IOS_API_KEY: null,
        VITE_REVENUECAT_SYNC_ENTITLEMENT: "staging-sync",
        VITE_WS_URL: null,
      },
    });
  });

  test("production keeps its default target and root release environment", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nVITE_WS_URL=wss://production.example\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nDEEPSEEK_API_KEY=server-secret\n",
      {},
      null,
    );

    expect(snapshot).toEqual({
      androidBuildVariant: "release",
      appIdentifier: "com.tearleads.app",
      disallowedIosStoreKey: "appl_staging",
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: "root",
        VITE_REVENUECAT_ANDROID_API_KEY: "goog_root",
        VITE_REVENUECAT_IOS_API_KEY: "appl_root",
        VITE_REVENUECAT_SYNC_ENTITLEMENT: null,
        VITE_WS_URL: "wss://production.example",
      },
      iosConfiguration: "Release",
      iosScheme: "App",
    });
  });
});
