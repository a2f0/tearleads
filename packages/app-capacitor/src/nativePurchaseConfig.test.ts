import { expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

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

test("Capacitor normalizes staging and rejects unknown release tiers", async () => {
  const readAppId = async (tier: string) => {
    const child = Bun.spawn(
      [
        "bun",
        "-e",
        "import config from './capacitor.config.ts'; process.stdout.write(config.appId);",
      ],
      {
        cwd: packageRoot,
        env: { ...process.env, NATIVE_RELEASE_TIER: tier },
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

  await expect(readAppId(" Staging ")).resolves.toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "com.tearleads.app.staging",
  });
  const unknown = await readAppId("preview");
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
  expect(scheme).toContain('buildConfiguration = "Release-Staging"');
});

test("Fastlane selects store identities from one shared release target", async () => {
  const releaseTarget = await Bun.file(
    resolve(packageRoot, "fastlane/native_release_target.rb"),
  ).text();

  expect(releaseTarget).toContain("'com.tearleads.app'");
  expect(releaseTarget).toContain("'com.tearleads.app.staging'");
  expect(releaseTarget).toContain("ios_scheme: 'App-Staging'");
  expect(releaseTarget).toContain("android_build_variant: 'staging'");
  expect(releaseTarget).toContain("'cap:sync:staging'");
});
