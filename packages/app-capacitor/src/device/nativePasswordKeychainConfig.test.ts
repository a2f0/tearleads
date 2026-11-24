import { expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "../..");
const read = (path: string) => Bun.file(resolve(packageRoot, path)).text();

// Each bundle ID saves passwords under the app host its tier deploys, which
// serves the association file naming that bundle ID.
const WEB_CREDENTIAL_DOMAINS: Record<string, string> = {
  "com.tearleads.app": "app.tearleads.com",
  "com.tearleads.staging.app": "app-staging.tearleads.com",
};

function buildSetting(block: string, name: string) {
  return block
    .match(new RegExp(`\\n\\s*${name} = ([^;]+);`))?.[1]
    ?.replace(/^"|"$/g, "");
}

test("every App configuration claims the web credential domain of its bundle ID", async () => {
  const [project, entitlements, infoPlist] = await Promise.all([
    read("ios/App/App.xcodeproj/project.pbxproj"),
    read("ios/App/App/App.entitlements"),
    read("ios/App/App/Info.plist"),
  ]);
  const targetConfigurations = [
    ...project.matchAll(
      /isa = XCBuildConfiguration;[\s\S]*?buildSettings = \{([\s\S]*?)\n\t\t\t\};\n\t\t\tname = ([^;]+);/g,
    ),
  ].filter(([, settings]) => settings?.includes("PRODUCT_BUNDLE_IDENTIFIER"));
  expect(
    targetConfigurations.map(([, settings = "", name]) => ({
      name,
      bundleId: buildSetting(settings, "PRODUCT_BUNDLE_IDENTIFIER"),
      entitlements: buildSetting(settings, "CODE_SIGN_ENTITLEMENTS"),
      domain: buildSetting(settings, "WEB_CREDENTIAL_DOMAIN"),
    })),
  ).toEqual(
    [
      ["Debug", "com.tearleads.app"],
      ["Release", "com.tearleads.app"],
      ['"Release-Staging"', "com.tearleads.staging.app"],
    ].map(([name, bundleId = ""]) => ({
      name,
      bundleId,
      entitlements: "App/App.entitlements",
      domain: WEB_CREDENTIAL_DOMAINS[bundleId],
    })),
  );
  // The entitlement and the domain the plugin saves under read one setting.
  expect(entitlements).toContain(
    "<key>com.apple.developer.associated-domains</key>",
  );
  expect(entitlements).toContain(
    "<string>webcredentials:$(WEB_CREDENTIAL_DOMAIN)</string>",
  );
  expect(infoPlist).toMatch(
    /<key>TearleadsWebCredentialDomain<\/key>\s*<string>\$\(WEB_CREDENTIAL_DOMAIN\)<\/string>/,
  );
});

test("the iOS app registers, compiles, and tests the PasswordKeychain plugin", async () => {
  const [project, bridgeController, plugin, nativeCheck] = await Promise.all([
    read("ios/App/App.xcodeproj/project.pbxproj"),
    read("ios/App/App/BridgeViewController.swift"),
    read("ios/App/App/PasswordKeychainPlugin.swift"),
    read("../../scripts/checks/testNativePurchaseBridge.sh"),
  ]);
  for (const source of [
    "PasswordKeychainPlugin.swift",
    "PasswordKeychainResults.swift",
  ]) {
    expect(project).toMatch(
      new RegExp(
        `Begin PBXSourcesBuildPhase[\\s\\S]*${source.replace(".", "\\.")} in Sources[\\s\\S]*End PBXSourcesBuildPhase`,
      ),
    );
  }
  expect(project).toContain(
    "path = ../PasswordKeychainState/Sources/PasswordKeychainState/PasswordKeychainResults.swift;",
  );
  expect(bridgeController).toContain(
    "bridge?.registerPluginInstance(PasswordKeychainPlugin())",
  );
  // The name the web layer registers in capacitorPasswordKeychain.ts.
  expect(plugin).toContain('let jsName = "PasswordKeychain"');
  expect(nativeCheck).toContain(
    "swift test --package-path ios/App/PasswordKeychainState",
  );
});
