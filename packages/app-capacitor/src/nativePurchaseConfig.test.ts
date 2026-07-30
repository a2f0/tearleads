import { expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

function xcodeConfigurationSettings(
  project: string,
  owner: "PBXProject" | "PBXNativeTarget",
  configuration: "Release" | "Release-Staging",
) {
  const configurationList = project.match(
    new RegExp(
      `Build configuration list for ${owner} "App" \\*/ = \\{[\\s\\S]*?buildConfigurations = \\(([\\s\\S]*?)\\);`,
    ),
  )?.[1];
  const configurationId = configurationList?.match(
    new RegExp(`([A-F0-9]{24}) /\\* ${configuration} \\*/`),
  )?.[1];
  if (configurationId === undefined) {
    throw new Error(`Could not find ${owner} ${configuration} configuration`);
  }

  const settings = project.match(
    new RegExp(
      `${configurationId} /\\* ${configuration} \\*/ = \\{[\\s\\S]*?buildSettings = \\{([\\s\\S]*?)\\n\\s*\\};`,
    ),
  )?.[1];
  if (settings === undefined) {
    throw new Error(`Could not read ${owner} ${configuration} settings`);
  }

  return settings
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function withoutXcodeSettings(settings: string[], excludedNames: string[]) {
  return settings.filter(
    (line) => !excludedNames.some((name) => line.startsWith(`${name} =`)),
  );
}

test("Android can resume a purchase after external payment verification", async () => {
  const manifest = await Bun.file(
    resolve(packageRoot, "android/app/src/main/AndroidManifest.xml"),
  ).text();

  const mainActivity = manifest
    .match(/<activity\b[\s\S]*?<\/activity>/g)
    ?.find((activity) => activity.includes('android:name=".MainActivity"'));

  expect(mainActivity).toBeDefined();
  expect(mainActivity).toContain('android:launchMode="singleTop"');
});

test("iOS pins the In-App Purchase project attribute", async () => {
  const project = await Bun.file(
    resolve(packageRoot, "ios/App/App.xcodeproj/project.pbxproj"),
  ).text();

  expect(project).toMatch(
    /com\.apple\.InAppPurchase = \{\s*enabled = 1;\s*\};/,
  );
});

test("Android exposes a signed staging release variant", async () => {
  const [gradle, stagingStrings] = await Promise.all([
    Bun.file(resolve(packageRoot, "android/app/build.gradle")).text(),
    Bun.file(
      resolve(packageRoot, "android/app/src/staging/res/values/strings.xml"),
    ).text(),
  ]);

  expect(gradle).toMatch(/staging\s*\{[\s\S]*?initWith release/);
  expect(gradle).toContain('applicationIdSuffix ".staging"');
  expect(stagingStrings).toContain("com.tearleads.app.staging");
  expect(stagingStrings).toContain("Tearleads Staging");
});

test("Capacitor pins production identity and rejects unknown release tiers", async () => {
  const readNativeIdentity = async (tier: string | null) => {
    const environment = { ...process.env };
    Reflect.deleteProperty(environment, "NATIVE_RELEASE_TIER");
    if (tier !== null) {
      Object.assign(environment, { NATIVE_RELEASE_TIER: tier });
    }
    const child = Bun.spawn(
      [
        "bun",
        "-e",
        "import config from './capacitor.config.ts'; process.stdout.write(JSON.stringify({appId: config.appId, iosKeychainPrefix: config.plugins?.CapacitorSQLite?.iosKeychainPrefix}));",
      ],
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
    return { exitCode, stderr, stdout };
  };

  const productionIdentity = {
    appId: "com.tearleads.app",
    iosKeychainPrefix: "com.tearleads.app",
  };
  const defaultProduction = await readNativeIdentity(null);
  expect(defaultProduction.exitCode).toBe(0);
  expect(JSON.parse(defaultProduction.stdout)).toEqual(productionIdentity);
  const explicitProduction = await readNativeIdentity("production");
  expect(explicitProduction.exitCode).toBe(0);
  expect(JSON.parse(explicitProduction.stdout)).toEqual(productionIdentity);
  const staging = await readNativeIdentity(" Staging ");
  expect(staging.exitCode).toBe(0);
  expect(JSON.parse(staging.stdout)).toEqual({
    appId: "com.tearleads.app.staging",
    iosKeychainPrefix: "com.tearleads.app.staging",
  });
  const unknown = await readNativeIdentity("preview");
  expect(unknown.exitCode).not.toBe(0);
  expect(unknown.stderr).toContain("Unknown NATIVE_RELEASE_TIER");
});

test("iOS exposes a staging release configuration and shared scheme", async () => {
  const [project, scheme] = await Promise.all([
    Bun.file(
      resolve(packageRoot, "ios/App/App.xcodeproj/project.pbxproj"),
    ).text(),
    Bun.file(
      resolve(
        packageRoot,
        "ios/App/App.xcodeproj/xcshareddata/xcschemes/App-Staging.xcscheme",
      ),
    ).text(),
  ]);

  expect(project).toContain("Release-Staging");
  expect(project).toContain(
    "PRODUCT_BUNDLE_IDENTIFIER = com.tearleads.app.staging;",
  );
  const targetBuildSettings = Array.from(
    project.matchAll(
      /buildSettings = \{((?:(?!\n\s*\};)[\s\S])*?INFOPLIST_FILE = App\/Info\.plist;(?:(?!\n\s*\};)[\s\S])*?)\n\s*\};/g,
    ),
    (match) => match[1] ?? "",
  );
  expect(targetBuildSettings).toHaveLength(3);
  expect(
    targetBuildSettings.filter((settings) =>
      settings.includes("APP_DISPLAY_NAME = Tearleads;"),
    ),
  ).toHaveLength(2);
  expect(
    targetBuildSettings.filter((settings) =>
      settings.includes('APP_DISPLAY_NAME = "Tearleads Staging";'),
    ),
  ).toHaveLength(1);
  expect(
    targetBuildSettings.every((settings) =>
      settings.includes("APP_DISPLAY_NAME ="),
    ),
  ).toBeTrue();
  expect(scheme).toContain('buildConfiguration = "Release-Staging"');
});

test("iOS staging release settings stay aligned with production", async () => {
  const project = await Bun.file(
    resolve(packageRoot, "ios/App/App.xcodeproj/project.pbxproj"),
  ).text();
  const projectRelease = xcodeConfigurationSettings(
    project,
    "PBXProject",
    "Release",
  );
  const projectStaging = xcodeConfigurationSettings(
    project,
    "PBXProject",
    "Release-Staging",
  );
  expect(projectStaging).toEqual(projectRelease);

  const targetRelease = xcodeConfigurationSettings(
    project,
    "PBXNativeTarget",
    "Release",
  );
  const targetStaging = xcodeConfigurationSettings(
    project,
    "PBXNativeTarget",
    "Release-Staging",
  );
  const intendedDifferences = ["APP_DISPLAY_NAME", "PRODUCT_BUNDLE_IDENTIFIER"];
  expect(withoutXcodeSettings(targetStaging, intendedDifferences)).toEqual(
    withoutXcodeSettings(targetRelease, intendedDifferences),
  );
  expect(targetRelease).toContain("APP_DISPLAY_NAME = Tearleads;");
  expect(targetRelease).toContain(
    "PRODUCT_BUNDLE_IDENTIFIER = com.tearleads.app;",
  );
  expect(targetStaging).toContain('APP_DISPLAY_NAME = "Tearleads Staging";');
  expect(targetStaging).toContain(
    "PRODUCT_BUNDLE_IDENTIFIER = com.tearleads.app.staging;",
  );
});

test("Fastlane selects store identities from one shared release target", async () => {
  const [releaseTarget, packageManifest] = await Promise.all([
    Bun.file(resolve(packageRoot, "fastlane/native_release_target.rb")).text(),
    Bun.file(resolve(packageRoot, "package.json")).json(),
  ]);

  expect(releaseTarget).toContain("'com.tearleads.app'");
  expect(releaseTarget).toContain("'com.tearleads.app.staging'");
  expect(releaseTarget).toContain("ios_scheme: 'App-Staging'");
  expect(releaseTarget).toContain("android_build_variant: 'staging'");
  expect(releaseTarget).toContain("'cap:sync:staging'");
  expect(packageManifest.scripts["cap:sync:debug"]).toContain(
    "NATIVE_RELEASE_TIER=production",
  );
  expect(packageManifest.scripts["cap:sync:release"]).toContain(
    "NATIVE_RELEASE_TIER=production",
  );
  for (const scriptName of [
    "cap:open:android",
    "cap:open:ios",
    "cap:run:android",
    "cap:run:ios",
  ]) {
    expect(packageManifest.scripts[scriptName]).toContain(
      "NATIVE_RELEASE_TIER=production",
    );
  }
  for (const scriptName of [
    "android:build:debug",
    "android:build:google-play",
    "android:build:release",
    "android:sideload",
    "android:sideload:debug",
    "android:sideload:release",
    "android:upload:google-play",
    "ios:build:testflight",
    "ios:fetch:appstore-profile",
    "ios:upload:testflight",
    "store:build-numbers",
  ]) {
    expect(packageManifest.scripts[scriptName]).toContain(
      "NATIVE_RELEASE_TIER=production",
    );
  }
  for (const scriptName of [
    "android:build:google-play:staging",
    "android:upload:google-play:staging",
    "ios:build:testflight:staging",
    "ios:fetch:appstore-profile:staging",
    "ios:upload:testflight:staging",
    "store:build-numbers:staging",
  ]) {
    expect(packageManifest.scripts[scriptName]).toContain(
      "NATIVE_RELEASE_TIER=staging",
    );
  }
});
