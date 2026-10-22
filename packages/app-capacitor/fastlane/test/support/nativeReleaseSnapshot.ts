import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { requireRubyBundle } from "./requireRubyBundle";

export const packageRoot = resolve(import.meta.dir, "../../..");
export const nativeReleaseTargetPath = resolve(
  packageRoot,
  "fastlane/lib/native_release_target.rb",
);
const snapshotScriptPath = resolve(
  packageRoot,
  "fastlane/test/support/native_release_snapshot.rb",
);

export interface NativeReleaseSnapshot {
  androidBuildVariant: string;
  androidBuildVariantTask: string;
  appIdentifier: string;
  iosArchiveRelativePath: string;
  productionIosStoreKey: string | null;
  releaseAabRelativePath: string;
  releaseMappingRelativePath: string;
  releaseNativeDebugSymbolsRelativePath: string;
  environment: Record<string, string | null>;
  iosConfiguration: string;
  iosScheme: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function recordValue(
  value: Record<string, unknown>,
  key: string,
): unknown {
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
  const androidBuildVariantTask = recordValue(value, "androidBuildVariantTask");
  const appIdentifier = recordValue(value, "appIdentifier");
  const iosArchiveRelativePath = recordValue(value, "iosArchiveRelativePath");
  const iosConfiguration = recordValue(value, "iosConfiguration");
  const iosScheme = recordValue(value, "iosScheme");
  const releaseAabRelativePath = recordValue(value, "releaseAabRelativePath");
  const releaseMappingRelativePath = recordValue(
    value,
    "releaseMappingRelativePath",
  );
  const releaseNativeDebugSymbolsRelativePath = recordValue(
    value,
    "releaseNativeDebugSymbolsRelativePath",
  );
  if (
    typeof androidBuildVariant !== "string" ||
    typeof androidBuildVariantTask !== "string" ||
    typeof appIdentifier !== "string" ||
    typeof iosArchiveRelativePath !== "string" ||
    typeof iosConfiguration !== "string" ||
    typeof iosScheme !== "string" ||
    typeof releaseAabRelativePath !== "string" ||
    typeof releaseMappingRelativePath !== "string" ||
    typeof releaseNativeDebugSymbolsRelativePath !== "string"
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
    androidBuildVariantTask,
    appIdentifier,
    environment,
    iosArchiveRelativePath,
    iosConfiguration,
    iosScheme,
    productionIosStoreKey,
    releaseAabRelativePath,
    releaseMappingRelativePath,
    releaseNativeDebugSymbolsRelativePath,
  };
}

export const stagingTarget = {
  androidBuildVariant: "staging",
  androidBuildVariantTask: "Staging",
  appIdentifier: "com.tearleads.staging.app",
  iosArchiveRelativePath: "output/staging/Tearleads-Staging.xcarchive",
  iosConfiguration: "Release-Staging",
  iosScheme: "App-Staging",
  releaseAabRelativePath: "bundle/staging/app-staging.aab",
  releaseMappingRelativePath: "mapping/staging/mapping.txt",
  releaseNativeDebugSymbolsRelativePath:
    "native-debug-symbols/staging/native-debug-symbols.zip",
};

// Server-oriented production values that no native release may import.
const productionAppEnv =
  "SERVER_SECRET=production-server-secret\nNATIVE_TEST_VALUE=production-app\nVITE_REVENUECAT_IOS_API_KEY=appl_production_app\n";

// Names the snapshot reports; the caller's environment must not leak them.
const snapshotEnvironmentNames = [
  "ANDROID_KEYSTORE_STORE_PASS",
  "NATIVE_RELEASE_PRODUCTION_VITE_REVENUECAT_ANDROID_API_KEY",
  "NATIVE_RELEASE_PRODUCTION_VITE_REVENUECAT_IOS_API_KEY",
  "NATIVE_RELEASE_SECRETS_DIR",
  "NATIVE_RELEASE_TIER",
  "NATIVE_TEST_VALUE",
  "SERVER_SECRET",
  "TEAM_ID",
  "VITE_API_BASE_URL",
  "VITE_REVENUECAT_ANDROID_API_KEY",
  "VITE_REVENUECAT_IOS_API_KEY",
  "VITE_REVENUECAT_SYNC_ENTITLEMENT",
  "VITE_WS_URL",
];

// Loads a copy of native_release_target.rb from a temporary repository whose
// `.secrets` holds the given files. `sharedEnv` is each tier's shared.env unless
// `prodSharedEnv` gives production its own; `stagingAppEnv` is staging's
// app.env. `files` adds or replaces files by path from the temporary root.
export async function readNativeReleaseEnvironmentResult(
  sharedEnv: string,
  stagingAppEnv: string,
  processEnvironment: Record<string, string> = {},
  tier: string | null = "staging",
  prodSharedEnv: string = sharedEnv,
  files: Record<string, string> = {},
) {
  await requireRubyBundle();
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "tearleads-native-release-target-"),
  );
  const copiedTargetPath = join(
    temporaryRoot,
    "packages/app-capacitor/fastlane/lib/native_release_target.rb",
  );
  const fixtureFiles: Record<string, string> = {
    ".secrets/staging/shared.env": sharedEnv,
    ".secrets/staging/app.env": stagingAppEnv,
    ".secrets/prod/shared.env": prodSharedEnv,
    ".secrets/prod/app.env": productionAppEnv,
    ...files,
  };
  await mkdir(dirname(copiedTargetPath), { recursive: true });
  await Bun.write(copiedTargetPath, Bun.file(nativeReleaseTargetPath));
  await Promise.all(
    Object.entries(fixtureFiles).map(([path, contents]) =>
      Bun.write(join(temporaryRoot, path), contents),
    ),
  );

  const environment = { ...process.env };
  for (const name of snapshotEnvironmentNames) {
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
    return { snapshot: parseNativeReleaseSnapshot(stdout), stderr };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function readNativeReleaseEnvironment(
  sharedEnv: string,
  stagingAppEnv: string,
  processEnvironment: Record<string, string> = {},
  tier: string | null = "staging",
  prodSharedEnv: string = sharedEnv,
  files: Record<string, string> = {},
) {
  const result = await readNativeReleaseEnvironmentResult(
    sharedEnv,
    stagingAppEnv,
    processEnvironment,
    tier,
    prodSharedEnv,
    files,
  );
  return result.snapshot;
}
