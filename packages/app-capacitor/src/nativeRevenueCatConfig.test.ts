import { expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

function requiredMatch(source: string, pattern: RegExp, description: string) {
  const value = source.match(pattern)?.[1];
  if (value === undefined) {
    throw new Error(`Could not find ${description}`);
  }
  return value;
}

test("iOS project registers the RevenueCat purchase plugin contract", async () => {
  const [project, bridgeController, purchasePlugin] = await Promise.all([
    Bun.file(
      resolve(packageRoot, "ios/App/App.xcodeproj/project.pbxproj"),
    ).text(),
    Bun.file(
      resolve(packageRoot, "ios/App/App/BridgeViewController.swift"),
    ).text(),
    Bun.file(
      resolve(packageRoot, "ios/App/App/RevenueCatPurchasePlugin.swift"),
    ).text(),
  ]);

  expect(project).toMatch(
    /Begin PBXSourcesBuildPhase[\s\S]*RevenueCatPurchasePlugin\.swift in Sources[\s\S]*End PBXSourcesBuildPhase/,
  );
  expect(bridgeController).toContain(
    "bridge?.registerPluginInstance(RevenueCatPurchasePlugin())",
  );
  expect(purchasePlugin).toContain(
    "nativeError.domain == ErrorCode.errorDomain",
  );
  expect(purchasePlugin).toContain("Self.reject(call, error: error)");
  expect(purchasePlugin).toContain(
    "package.storeProduct.productIdentifier == productId",
  );
  expect(purchasePlugin).toContain(
    "candidate.userInfo[NSUnderlyingErrorKey] as? NSError",
  );
});

test("iOS RevenueCat project pin matches the resolved SDK version", async () => {
  const [project, packageResolution] = await Promise.all([
    Bun.file(
      resolve(packageRoot, "ios/App/App.xcodeproj/project.pbxproj"),
    ).text(),
    Bun.file(
      resolve(
        packageRoot,
        "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
      ),
    ).text(),
  ]);

  const projectVersion = requiredMatch(
    project,
    /repositoryURL = "https:\/\/github\.com\/RevenueCat\/purchases-ios-spm";[\s\S]*?kind = exactVersion;[\s\S]*?version = ([^;]+);/,
    "RevenueCat Xcode package version",
  );
  const resolvedVersion = requiredMatch(
    packageResolution,
    /"identity" : "purchases-ios-spm"[\s\S]*?"version" : "([^"]+)"/,
    "resolved RevenueCat package version",
  );

  expect(projectVersion).toBe(resolvedVersion);
});
