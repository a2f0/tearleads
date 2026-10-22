import { describe, expect, test } from "bun:test";
import {
  readNativeReleaseEnvironment,
  readNativeReleaseEnvironmentResult,
} from "./support/nativeReleaseSnapshot";

// Both files also hold server values; only store names may reach the lanes.
const sharedEnv =
  "TEAM_ID=shared-team\nANDROID_KEYSTORE_STORE_PASS=shared-pass\nSERVER_SECRET=shared-server\nNATIVE_TEST_VALUE=shared\n";
const appEnv =
  "ANDROID_KEYSTORE_STORE_PASS=app-pass\nSERVER_SECRET=app-server\nNATIVE_TEST_VALUE=app\n";
const storeEnvironment = {
  ANDROID_KEYSTORE_STORE_PASS: "app-pass",
  NATIVE_TEST_VALUE: null,
  SERVER_SECRET: null,
  TEAM_ID: "shared-team",
};

describe("native release secrets", () => {
  test("production imports store names from shared.env, then app.env", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "",
      "",
      {},
      "production",
      sharedEnv,
      { ".secrets/prod/app.env": appEnv },
    );

    expect(snapshot.environment).toMatchObject(storeEnvironment);
  });

  test("staging imports store names from shared.env, then app.env", async () => {
    const snapshot = await readNativeReleaseEnvironment(sharedEnv, appEnv);

    expect(snapshot.environment).toMatchObject(storeEnvironment);
  });

  test("production ignores Vite settings in its server-oriented app.env", async () => {
    const result = await readNativeReleaseEnvironmentResult(
      "",
      "",
      {},
      "production",
      "VITE_REVENUECAT_IOS_API_KEY=appl_shared\n",
      { ".secrets/prod/app.env": "VITE_REVENUECAT_IOS_API_KEY=appl_app\n" },
    );

    expect(result.snapshot.environment).toMatchObject({
      VITE_REVENUECAT_IOS_API_KEY: "appl_shared",
    });
    expect(result.stderr).toContain(
      "Ignoring prod/app.env Vite settings for production: VITE_REVENUECAT_IOS_API_KEY",
    );
  });

  test("NATIVE_RELEASE_SECRETS_DIR replaces the staging secrets folder", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "TEAM_ID=tier-team\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_tier\n",
      { NATIVE_RELEASE_SECRETS_DIR: "override" },
      "staging",
      "VITE_REVENUECAT_IOS_API_KEY=appl_prod\n",
      {
        "packages/app-capacitor/override/shared.env": "TEAM_ID=override-team\n",
        "packages/app-capacitor/override/app.env":
          "ANDROID_KEYSTORE_STORE_PASS=override-pass\nVITE_REVENUECAT_IOS_API_KEY=appl_override\n",
      },
    );

    // Staging still compares its key with production's shared.env.
    expect(snapshot.productionIosStoreKey).toBe("appl_prod");
    expect(snapshot.environment).toMatchObject({
      ANDROID_KEYSTORE_STORE_PASS: "override-pass",
      TEAM_ID: "override-team",
      VITE_REVENUECAT_IOS_API_KEY: "appl_override",
    });
  });

  test("NATIVE_RELEASE_SECRETS_DIR also moves production's key baseline", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "",
      "",
      { NATIVE_RELEASE_SECRETS_DIR: "override" },
      "production",
      "VITE_REVENUECAT_IOS_API_KEY=appl_prod\n",
      {
        "packages/app-capacitor/override/shared.env":
          "VITE_REVENUECAT_IOS_API_KEY=appl_override\n",
      },
    );

    expect(snapshot.productionIosStoreKey).toBe("appl_override");
    expect(snapshot.environment).toMatchObject({
      VITE_REVENUECAT_IOS_API_KEY: "appl_override",
    });
  });
});
