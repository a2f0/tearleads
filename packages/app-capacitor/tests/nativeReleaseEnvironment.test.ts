import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { requireRubyBundle } from "./requireRubyBundle";

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

function rubyWordArray(source: string, constantName: string): string[] {
  const body = source.match(
    new RegExp(`${constantName} = %w\\[([\\s\\S]*?)\\]\\.freeze`),
  )?.[1];
  if (body === undefined) {
    throw new Error(`Could not find Ruby word array ${constantName}`);
  }
  return body.trim().split(/\s+/);
}

interface NativeReleaseSnapshot {
  androidBuildVariant: string;
  appIdentifier: string;
  productionIosStoreKey: string | null;
  environment: Record<string, string | null>;
  iosConfiguration: string;
  iosScheme: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordValue(value: Record<string, unknown>, key: string): unknown {
  return value[key];
}

function parseNativeReleaseSnapshot(stdout: string): NativeReleaseSnapshot {
  const value: unknown = JSON.parse(stdout);
  if (!isRecord(value)) {
    throw new Error("Native release snapshot must be an object");
  }
  const environmentValue = recordValue(value, "environment");
  if (!isRecord(environmentValue)) {
    throw new Error(
      "Native release snapshot must be an object with an environment",
    );
  }

  const androidBuildVariant = recordValue(value, "androidBuildVariant");
  const appIdentifier = recordValue(value, "appIdentifier");
  const iosConfiguration = recordValue(value, "iosConfiguration");
  const iosScheme = recordValue(value, "iosScheme");
  if (
    typeof androidBuildVariant !== "string" ||
    typeof appIdentifier !== "string" ||
    typeof iosConfiguration !== "string" ||
    typeof iosScheme !== "string"
  ) {
    throw new Error("Native release snapshot target fields must be strings");
  }
  const productionIosStoreKey = recordValue(value, "productionIosStoreKey");
  if (
    productionIosStoreKey !== null &&
    typeof productionIosStoreKey !== "string"
  ) {
    throw new Error("Native release snapshot production key must be nullable");
  }
  const environment: Record<string, string | null> = {};
  for (const [name, entry] of Object.entries(environmentValue)) {
    if (entry !== null && typeof entry !== "string") {
      throw new Error(
        "Native release snapshot environment values must be nullable strings",
      );
    }
    environment[name] = entry;
  }

  return {
    androidBuildVariant,
    appIdentifier,
    environment,
    iosConfiguration,
    iosScheme,
    productionIosStoreKey,
  };
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
  await requireRubyBundle();
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
    "VITE_API_BASE_URL",
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
    return parseNativeReleaseSnapshot(stdout);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

describe("native release environments", () => {
  test("classifies every declared Capacitor Vite environment name", async () => {
    const [declarations, targetSource] = await Promise.all([
      Bun.file(resolve(packageRoot, "src/vite-env.d.ts")).text(),
      Bun.file(nativeReleaseTargetPath).text(),
    ]);
    const declaredNames = [
      ...declarations.matchAll(/readonly (VITE_[A-Z0-9_]+)\?:/g),
    ].map((match) => {
      const name = match[1];
      if (name === undefined) {
        throw new Error("Vite environment declaration has no name");
      }
      return name;
    });
    const classifiedNames = [
      ...rubyWordArray(targetSource, "NATIVE_SHARED_VITE_ENV_NAMES"),
      ...rubyWordArray(targetSource, "NATIVE_STAGING_PLATFORM_VITE_ENV_NAMES"),
      ...rubyWordArray(targetSource, "NATIVE_RELEASE_MANAGED_VITE_ENV_NAMES"),
    ];

    expect(classifiedNames.sort()).toEqual(declaredNames.sort());
  });

  test("staging imports only its allowlisted native client settings", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nVITE_REVENUECAT_SYNC_ENTITLEMENT=sync\nVITE_WS_URL=wss://production.example\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nVITE_REVENUECAT_ANDROID_API_KEY=goog_staging\nVITE_WS_URL=wss://staging.example\nNATIVE_TEST_VALUE=staging\nDEEPSEEK_API_KEY=server-secret\n",
    );

    expect(snapshot).toEqual({
      ...stagingTarget,
      productionIosStoreKey: "appl_root",
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: "root",
        VITE_API_BASE_URL: "https://api.tearleads.de",
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
        VITE_WS_URL: "wss://events.tearleads.de/socket",
      },
    );

    expect(snapshot).toEqual({
      ...stagingTarget,
      productionIosStoreKey: "appl_root",
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: "process",
        VITE_API_BASE_URL: "https://api.tearleads.de",
        VITE_REVENUECAT_ANDROID_API_KEY: "goog_staging",
        VITE_REVENUECAT_IOS_API_KEY: "appl_process",
        VITE_REVENUECAT_SYNC_ENTITLEMENT: null,
        VITE_WS_URL: "wss://events.tearleads.de/socket",
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
      productionIosStoreKey: "appl_root",
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: "root",
        VITE_API_BASE_URL: "https://api.tearleads.de",
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
      productionIosStoreKey: null,
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: null,
        VITE_API_BASE_URL: "https://api.tearleads.de",
        VITE_REVENUECAT_ANDROID_API_KEY: null,
        VITE_REVENUECAT_IOS_API_KEY: null,
        VITE_REVENUECAT_SYNC_ENTITLEMENT: "staging-sync",
        VITE_WS_URL: null,
      },
    });
  });

  test("production keeps its default target and root release environment", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nVITE_WS_URL=wss://events.tearleads.com/socket\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nDEEPSEEK_API_KEY=server-secret\n",
      {},
      null,
    );

    expect(snapshot).toEqual({
      androidBuildVariant: "release",
      appIdentifier: "com.tearleads.app",
      productionIosStoreKey: "appl_root",
      environment: {
        DEEPSEEK_API_KEY: null,
        NATIVE_TEST_VALUE: "root",
        VITE_API_BASE_URL: "https://api.tearleads.com",
        VITE_REVENUECAT_ANDROID_API_KEY: "goog_root",
        VITE_REVENUECAT_IOS_API_KEY: "appl_root",
        VITE_REVENUECAT_SYNC_ENTITLEMENT: null,
        VITE_WS_URL: "wss://events.tearleads.com/socket",
      },
      iosConfiguration: "Release",
      iosScheme: "App",
    });
  });

  test("validates service URLs after dotenv and explicit values resolve", async () => {
    await expect(
      readNativeReleaseEnvironment(
        "VITE_WS_URL=wss://events.tearleads.de/socket\n",
        "",
        {},
        null,
      ),
    ).rejects.toThrow("VITE_WS_URL must use tearleads.com");

    await expect(
      readNativeReleaseEnvironment("", "", {
        VITE_API_BASE_URL: "https://api.tearleads.de/v1",
        VITE_WS_URL: "wss://events.tearleads.de/socket",
      }),
    ).resolves.toMatchObject(stagingTarget);

    await expect(
      readNativeReleaseEnvironment("", "", {
        VITE_API_BASE_URL: "https://api.tearleads.de",
        VITE_WS_URL: "wss://events.tearleads.com/socket",
      }),
    ).rejects.toThrow("VITE_WS_URL must use tearleads.de");

    await expect(
      readNativeReleaseEnvironment("", "", {
        VITE_API_BASE_URL: "http://api.tearleads.de",
      }),
    ).rejects.toThrow("VITE_API_BASE_URL must use the https scheme");

    await expect(
      readNativeReleaseEnvironment("", "", {
        VITE_WS_URL: "ws://events.tearleads.de/socket",
      }),
    ).rejects.toThrow("VITE_WS_URL must use the wss scheme");
  });
});
