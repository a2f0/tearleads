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
