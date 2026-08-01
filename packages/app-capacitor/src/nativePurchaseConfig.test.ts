import { expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordValue(value: Record<string, unknown>, key: string): unknown {
  return value[key];
}

function parseNativeIdentity(stdout: string) {
  const value: unknown = JSON.parse(stdout);
  if (!isRecord(value)) {
    throw new Error("Native identity output is invalid");
  }
  const appId = recordValue(value, "appId");
  const iosKeychainPrefix = recordValue(value, "iosKeychainPrefix");
  if (typeof appId !== "string" || typeof iosKeychainPrefix !== "string") {
    throw new Error("Native identity output is invalid");
  }
  return {
    appId,
    iosKeychainPrefix,
  };
}

async function readNativeIdentity(tier: string | null) {
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
}

function packageScripts(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Capacitor package scripts are invalid");
  }
  const scriptsValue = recordValue(value, "scripts");
  if (!isRecord(scriptsValue)) {
    throw new Error("Capacitor package scripts are invalid");
  }
  const scripts: Record<string, string> = {};
  for (const [name, script] of Object.entries(scriptsValue)) {
    if (typeof script !== "string") {
      throw new Error("Capacitor package scripts must be strings");
    }
    scripts[name] = script;
  }
  return scripts;
}

async function readJson(path: string): Promise<unknown> {
  const value: unknown = await Bun.file(path).json();
  return value;
}

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

function namedBraceBlock(source: string, name: string) {
  const blockStart = new RegExp(`\\b${name}\\s*\\{`).exec(source);
  if (blockStart === null) {
    throw new Error(`Could not find ${name} block`);
  }
  const openingBrace = blockStart.index + blockStart[0].lastIndexOf("{");
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openingBrace + 1, index);
      }
    }
  }
  throw new Error(`Could not read ${name} block`);
}

function quotedGradleSetting(block: string, name: string) {
  const value = block.match(new RegExp(`\\b${name}\\s+"([^"]+)"`))?.[1];
  if (value === undefined) {
    throw new Error(`Could not find Gradle setting ${name}`);
  }
  return value;
}

function effectiveAndroidApplicationId(gradle: string, buildType: string) {
  const baseId = quotedGradleSetting(
    namedBraceBlock(gradle, "defaultConfig"),
    "applicationId",
  );
  const buildTypeBlock = namedBraceBlock(
    namedBraceBlock(gradle, "buildTypes"),
    buildType,
  );
  const suffix = quotedGradleSetting(buildTypeBlock, "applicationIdSuffix");
  const inheritedBuildType = buildTypeBlock.match(/\binitWith\s+(\w+)/)?.[1];
  const initWithIndex = buildTypeBlock.search(/\binitWith\s+\w+/);
  const suffixIndex = buildTypeBlock.search(/\bapplicationIdSuffix\s+"/);
  if (inheritedBuildType !== undefined && initWithIndex > suffixIndex) {
    return effectiveAndroidApplicationId(gradle, inheritedBuildType);
  }
  return `${baseId}${suffix}`;
}

function androidBuildTypeNames(gradle: string) {
  const buildTypes = namedBraceBlock(gradle, "buildTypes");
  const names: string[] = [];
  let depth = 0;
  for (const match of buildTypes.matchAll(/\b(\w+)\s*\{|[{}]/g)) {
    if (match[0] === "{") {
      depth += 1;
    } else if (match[0] === "}") {
      depth -= 1;
    } else {
      if (depth === 0 && match[1] !== undefined) {
        names.push(match[1]);
      }
      depth += 1;
    }
  }
  return names;
}

function requiredMatch(source: string, pattern: RegExp, description: string) {
  const value = source.match(pattern)?.[1];
  if (value === undefined) {
    throw new Error(`Could not find ${description}`);
  }
  return value;
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

test("Android staging inherits the production release signing variant", async () => {
  const [gradle, stagingStrings] = await Promise.all([
    Bun.file(resolve(packageRoot, "android/app/build.gradle")).text(),
    Bun.file(
      resolve(packageRoot, "android/app/src/staging/res/values/strings.xml"),
    ).text(),
  ]);

  expect(gradle).toMatch(
    /release\s*\{[\s\S]*?signingConfig hasReleaseKeystore\(\) \? signingConfigs\.release : signingConfigs\.debug/,
  );
  expect(gradle).toMatch(/staging\s*\{[\s\S]*?initWith release/);
  expect(effectiveAndroidApplicationId(gradle, "debug")).toBe(
    "com.tearleads.app",
  );
  expect(effectiveAndroidApplicationId(gradle, "release")).toBe(
    "com.tearleads.app",
  );
  expect(effectiveAndroidApplicationId(gradle, "staging")).toBe(
    "com.tearleads.staging.app",
  );
  for (const buildType of androidBuildTypeNames(gradle)) {
    expect(
      namedBraceBlock(namedBraceBlock(gradle, "buildTypes"), buildType),
    ).toContain("applicationIdSuffix");
  }
  expect(stagingStrings).toContain("com.tearleads.staging.app");
  expect(stagingStrings).toContain("Tearleads Staging");
});

test("Capacitor pins production identity and rejects unknown release tiers", async () => {
  const productionIdentity = {
    appId: "com.tearleads.app",
    iosKeychainPrefix: "com.tearleads.app",
  };
  const defaultProduction = await readNativeIdentity(null);
  expect(defaultProduction.exitCode).toBe(0);
  expect(parseNativeIdentity(defaultProduction.stdout)).toEqual(
    productionIdentity,
  );
  const explicitProduction = await readNativeIdentity("production");
  expect(explicitProduction.exitCode).toBe(0);
  expect(parseNativeIdentity(explicitProduction.stdout)).toEqual(
    productionIdentity,
  );
  const staging = await readNativeIdentity(" Staging ");
  expect(staging.exitCode).toBe(0);
  expect(parseNativeIdentity(staging.stdout)).toEqual({
    appId: "com.tearleads.staging.app",
    iosKeychainPrefix: "com.tearleads.staging.app",
  });
  const unknown = await readNativeIdentity("preview");
  expect(unknown.exitCode).not.toBe(0);
  expect(unknown.stderr).toContain("Unknown NATIVE_RELEASE_TIER");
});

test("iOS exposes a staging release configuration and shared scheme", async () => {
  const [infoPlist, project, scheme] = await Promise.all([
    Bun.file(resolve(packageRoot, "ios/App/App/Info.plist")).text(),
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
    "PRODUCT_BUNDLE_IDENTIFIER = com.tearleads.staging.app;",
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
  expect(infoPlist).toContain("$(APP_DISPLAY_NAME:default=Tearleads)");
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
    "PRODUCT_BUNDLE_IDENTIFIER = com.tearleads.staging.app;",
  );
});

test("Fastlane selects store identities from one shared release target", async () => {
  const [releaseTarget, packageManifestValue] = await Promise.all([
    Bun.file(
      resolve(packageRoot, "fastlane/lib/native_release_target.rb"),
    ).text(),
    readJson(resolve(packageRoot, "package.json")),
  ]);
  const scripts = packageScripts(packageManifestValue);

  expect(releaseTarget).toContain("'com.tearleads.app'");
  expect(releaseTarget).toContain("'com.tearleads.staging.app'");
  expect(releaseTarget).toContain("ios_scheme: 'App-Staging'");
  expect(releaseTarget).toContain("android_build_variant: 'staging'");
  expect(releaseTarget).toContain("'cap:sync:staging'");
  expect(scripts["cap:sync:debug"]).toContain("NATIVE_RELEASE_TIER=production");
  expect(scripts["cap:sync:release"]).toContain(
    "NATIVE_RELEASE_TIER=production",
  );
  for (const scriptName of [
    "cap:open:android",
    "cap:open:ios",
    "cap:run:android",
    "cap:run:ios",
  ]) {
    expect(scripts[scriptName]).toContain("NATIVE_RELEASE_TIER=production");
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
    expect(scripts[scriptName]).toContain("NATIVE_RELEASE_TIER=production");
  }
  for (const scriptName of [
    "android:build:google-play:staging",
    "android:upload:google-play:staging",
    "ios:build:testflight:staging",
    "ios:fetch:appstore-profile:staging",
    "ios:upload:testflight:staging",
    "store:build-numbers:staging",
  ]) {
    expect(scripts[scriptName]).toContain("NATIVE_RELEASE_TIER=staging");
  }
});

test("native staging store identifiers stay aligned", async () => {
  const [capacitorIdentity, gradle, project, releaseTarget] = await Promise.all(
    [
      readNativeIdentity(" Staging "),
      Bun.file(resolve(packageRoot, "android/app/build.gradle")).text(),
      Bun.file(
        resolve(packageRoot, "ios/App/App.xcodeproj/project.pbxproj"),
      ).text(),
      Bun.file(
        resolve(packageRoot, "fastlane/lib/native_release_target.rb"),
      ).text(),
    ],
  );
  expect(capacitorIdentity.exitCode).toBe(0);
  const identifiers = {
    android: effectiveAndroidApplicationId(gradle, "staging"),
    capacitor: parseNativeIdentity(capacitorIdentity.stdout).appId,
    fastlane: requiredMatch(
      releaseTarget,
      /'staging'\s*=>\s*\{[\s\S]*?app_identifier:\s*'([^']+)'/,
      "Fastlane staging app identifier",
    ),
    xcode: requiredMatch(
      xcodeConfigurationSettings(
        project,
        "PBXNativeTarget",
        "Release-Staging",
      ).find((setting) => setting.startsWith("PRODUCT_BUNDLE_IDENTIFIER =")) ??
        "",
      /= ([^;]+);/,
      "Xcode staging bundle identifier",
    ),
  };

  expect(identifiers).toEqual({
    android: "com.tearleads.staging.app",
    capacitor: "com.tearleads.staging.app",
    fastlane: "com.tearleads.staging.app",
    xcode: "com.tearleads.staging.app",
  });
});
