import { expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "../..");
const read = (path: string) => Bun.file(resolve(packageRoot, path)).text();
// Commented-out declarations do not count.
const liveManifest = async () =>
  (await read("android/app/src/main/AndroidManifest.xml")).replaceAll(
    /<!--[\s\S]*?-->/g,
    "",
  );

// The recovery QR scanner runs getUserMedia inside the WebView. Capacitor
// turns that request into Android's runtime CAMERA grant, which Android
// refuses for a permission the manifest does not declare.
test("Android declares the camera the WebView's live QR scanner asks for", async () => {
  const declarations = (await liveManifest()).match(
    /<uses-permission\s[^>]*android:name="android\.permission\.CAMERA"[^>]*\/>/g,
  );
  // One unconditional declaration: a maxSdkVersion would drop it on new Android.
  expect(declarations).toHaveLength(1);
  expect(declarations?.[0]).not.toContain("maxSdkVersion");
});

// Declaring CAMERA implies camera hardware is required, which would hide the
// app from devices without one; those restore with the passphrase instead.
test.each(["android.hardware.camera", "android.hardware.camera.autofocus"])(
  "Android keeps %s optional",
  async (feature) => {
    const declarations = (await liveManifest()).match(
      new RegExp(
        `<uses-feature\\s[^>]*android:name="${feature.replaceAll(".", "\\.")}"[^>]*/>`,
        "g",
      ),
    );
    expect(declarations).toHaveLength(1);
    expect(declarations?.[0]).toContain('android:required="false"');
  },
);

test("iOS explains camera use for recovery QR scanning", async () => {
  const infoPlist = await read("ios/App/App/Info.plist");
  const description = infoPlist.match(
    /<key>NSCameraUsageDescription<\/key>\s*<string>([^<]+)<\/string>/,
  )?.[1];
  expect(description).toContain("recovery QR");
});
