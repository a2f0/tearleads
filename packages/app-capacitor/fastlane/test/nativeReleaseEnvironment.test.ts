import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  nativeReleaseTargetPath,
  packageRoot,
  readNativeReleaseEnvironment,
  readNativeReleaseEnvironmentResult,
  recordValue,
  stagingTarget,
} from "./support/nativeReleaseSnapshot";

function rubyWordArray(source: string, constantName: string): string[] {
  const body = source.match(
    new RegExp(`${constantName} = %w\\[([\\s\\S]*?)\\]\\.freeze`),
  )?.[1];
  if (body === undefined) {
    throw new Error(`Could not find Ruby word array ${constantName}`);
  }
  return body.trim().split(/\s+/);
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
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nVITE_REVENUECAT_SYNC_ENTITLEMENT=sync\nVITE_WS_URL=wss://production.example\nTEAM_ID=root\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nVITE_REVENUECAT_ANDROID_API_KEY=goog_staging\nVITE_WS_URL=wss://staging.example\nNATIVE_TEST_VALUE=staging\nSERVER_SECRET=server-secret\n",
    );

    expect(snapshot).toEqual({
      ...stagingTarget,
      productionIosStoreKey: "appl_root",
      environment: {
        ANDROID_KEYSTORE_STORE_PASS: null,
        SERVER_SECRET: null,
        NATIVE_TEST_VALUE: null,
        TEAM_ID: "root",
        VITE_API_BASE_URL: "https://api-staging.tearleads.com",
        VITE_REVENUECAT_ANDROID_API_KEY: "goog_staging",
        VITE_REVENUECAT_IOS_API_KEY: "appl_staging",
        VITE_REVENUECAT_SYNC_ENTITLEMENT: "sync",
        VITE_WS_URL: null,
      },
    });
  });

  test("warns when staging's app.env contains ignored Vite settings", async () => {
    const result = await readNativeReleaseEnvironmentResult(
      "VITE_REVENUECAT_SYNC_ENTITLEMENT=sync\n",
      "VITE_WS_URL=wss://api-staging.tearleads.com/events\n",
    );

    expect(result.stderr).toContain(
      "Ignoring staging/app.env Vite settings for staging: VITE_WS_URL",
    );
    expect(recordValue(result.snapshot.environment, "VITE_WS_URL")).toBeNull();
  });

  test("explicit native release environment values beat dotenv files", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nTEAM_ID=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nVITE_REVENUECAT_ANDROID_API_KEY=goog_staging\nTEAM_ID=staging\n",
      {
        NATIVE_TEST_VALUE: "process",
        TEAM_ID: "process",
        VITE_REVENUECAT_IOS_API_KEY: "appl_process",
        VITE_WS_URL: "wss://api-staging.tearleads.com/events",
      },
    );

    expect(snapshot).toEqual({
      ...stagingTarget,
      productionIosStoreKey: "appl_root",
      environment: {
        ANDROID_KEYSTORE_STORE_PASS: null,
        SERVER_SECRET: null,
        NATIVE_TEST_VALUE: "process",
        TEAM_ID: "process",
        VITE_API_BASE_URL: "https://api-staging.tearleads.com",
        VITE_REVENUECAT_ANDROID_API_KEY: "goog_staging",
        VITE_REVENUECAT_IOS_API_KEY: "appl_process",
        VITE_REVENUECAT_SYNC_ENTITLEMENT: null,
        VITE_WS_URL: "wss://api-staging.tearleads.com/events",
      },
    });
  });

  test("accepts an independent production key baseline override", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\n",
      {
        NATIVE_RELEASE_PRODUCTION_VITE_REVENUECAT_IOS_API_KEY:
          "appl_production_baseline",
      },
    );

    expect(snapshot.productionIosStoreKey).toBe("appl_production_baseline");
    expect(
      recordValue(snapshot.environment, "VITE_REVENUECAT_IOS_API_KEY"),
    ).toBe("appl_staging");
  });

  test("production supports an env-only key and independent baseline", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "",
      "",
      {
        NATIVE_RELEASE_PRODUCTION_VITE_REVENUECAT_IOS_API_KEY:
          "appl_production",
        VITE_REVENUECAT_IOS_API_KEY: "appl_production",
      },
      "production",
    );

    expect(snapshot.productionIosStoreKey).toBe("appl_production");
    expect(
      recordValue(snapshot.environment, "VITE_REVENUECAT_IOS_API_KEY"),
    ).toBe("appl_production");
  });

  test("staging drops production platform keys when staging omits them", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nTEAM_ID=root\n",
      "NATIVE_TEST_VALUE=staging\n",
    );

    expect(snapshot).toEqual({
      ...stagingTarget,
      productionIosStoreKey: "appl_root",
      environment: {
        ANDROID_KEYSTORE_STORE_PASS: null,
        SERVER_SECRET: null,
        NATIVE_TEST_VALUE: null,
        TEAM_ID: "root",
        VITE_API_BASE_URL: "https://api-staging.tearleads.com",
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
        ANDROID_KEYSTORE_STORE_PASS: null,
        SERVER_SECRET: null,
        NATIVE_TEST_VALUE: null,
        TEAM_ID: null,
        VITE_API_BASE_URL: "https://api-staging.tearleads.com",
        VITE_REVENUECAT_ANDROID_API_KEY: null,
        VITE_REVENUECAT_IOS_API_KEY: null,
        VITE_REVENUECAT_SYNC_ENTITLEMENT: "staging-sync",
        VITE_WS_URL: null,
      },
    });
  });

  test("production keeps its default target and shared release environment", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nVITE_WS_URL=wss://api.tearleads.com/events\nTEAM_ID=root\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nSERVER_SECRET=server-secret\n",
      {},
      null,
    );

    expect(snapshot).toEqual({
      androidBuildVariant: "release",
      androidBuildVariantTask: "Release",
      appIdentifier: "com.tearleads.app",
      iosArchiveRelativePath: "output/Tearleads.xcarchive",
      productionIosStoreKey: "appl_root",
      releaseAabRelativePath: "bundle/release/app-release.aab",
      releaseMappingRelativePath: "mapping/release/mapping.txt",
      releaseNativeDebugSymbolsRelativePath:
        "native-debug-symbols/release/native-debug-symbols.zip",
      environment: {
        ANDROID_KEYSTORE_STORE_PASS: null,
        SERVER_SECRET: null,
        NATIVE_TEST_VALUE: null,
        TEAM_ID: "root",
        VITE_API_BASE_URL: "https://api.tearleads.com",
        VITE_REVENUECAT_ANDROID_API_KEY: "goog_root",
        VITE_REVENUECAT_IOS_API_KEY: "appl_root",
        VITE_REVENUECAT_SYNC_ENTITLEMENT: null,
        VITE_WS_URL: "wss://api.tearleads.com/events",
      },
      iosConfiguration: "Release",
      iosScheme: "App",
    });
  });

  test("each tier reads its own shared.env against production's key baseline", async () => {
    const stagingShared =
      "TEAM_ID=staging-shared\nVITE_REVENUECAT_IOS_API_KEY=appl_staging_shared\n";
    const prodShared =
      "TEAM_ID=prod-shared\nVITE_REVENUECAT_IOS_API_KEY=appl_prod\n";
    const stagingApp = "VITE_REVENUECAT_IOS_API_KEY=appl_staging\n";
    const staging = await readNativeReleaseEnvironment(
      stagingShared,
      stagingApp,
      {},
      "staging",
      prodShared,
    );
    expect(staging.productionIosStoreKey).toBe("appl_prod");
    expect(staging.environment).toMatchObject({
      TEAM_ID: "staging-shared",
      VITE_REVENUECAT_IOS_API_KEY: "appl_staging",
    });

    const production = await readNativeReleaseEnvironment(
      stagingShared,
      stagingApp,
      {},
      "production",
      prodShared,
    );
    expect(production.productionIosStoreKey).toBe("appl_prod");
    expect(production.environment).toMatchObject({
      SERVER_SECRET: null,
      NATIVE_TEST_VALUE: null,
      TEAM_ID: "prod-shared",
      VITE_REVENUECAT_IOS_API_KEY: "appl_prod",
    });
  });

  test("validates service URLs after dotenv and explicit values resolve", async () => {
    await expect(
      readNativeReleaseEnvironment(
        "VITE_WS_URL=wss://api-staging.tearleads.com/events\n",
        "",
        {},
        null,
      ),
    ).rejects.toThrow("VITE_WS_URL must use api.tearleads.com");

    await expect(
      readNativeReleaseEnvironment("", "", {
        VITE_API_BASE_URL: "https://api-staging.tearleads.com/v1",
        VITE_WS_URL: "wss://api-staging.tearleads.com/events",
      }),
    ).resolves.toMatchObject(stagingTarget);

    await expect(
      readNativeReleaseEnvironment("", "", {
        VITE_API_BASE_URL: "https://api-staging.tearleads.com",
        VITE_WS_URL: "wss://api.tearleads.com/events",
      }),
    ).rejects.toThrow("VITE_WS_URL must use api-staging.tearleads.com");

    await expect(
      readNativeReleaseEnvironment("", "", {
        VITE_API_BASE_URL: "http://api-staging.tearleads.com",
      }),
    ).rejects.toThrow("VITE_API_BASE_URL must use the https scheme");

    await expect(
      readNativeReleaseEnvironment("", "", {
        VITE_WS_URL: "ws://api-staging.tearleads.com/socket",
      }),
    ).rejects.toThrow("VITE_WS_URL must use the wss scheme");
  });
});
