import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { STORE_REPLACEMENT_MODE } from "@revenuecat/purchases-capacitor";

const packageRoot = resolve(import.meta.dir, "..");
const EXPECTED_ANDROID_REPLACEMENT_MODES = [
  "CHARGE_FULL_PRICE",
  "CHARGE_PRORATED_PRICE",
  "DEFERRED",
  "WITHOUT_PRORATION",
  "WITH_TIME_PRORATION",
];

function requiredMatch(source: string, pattern: RegExp, description: string) {
  const value = source.match(pattern)?.[1];
  if (value === undefined) {
    throw new Error(`Could not find ${description}`);
  }
  return value;
}

test("iOS project registers the RevenueCat purchase plugin contract", async () => {
  const [project, bridgeController, purchasePlugin, billingPurchaseTrace] =
    await Promise.all([
      Bun.file(
        resolve(packageRoot, "ios/App/App.xcodeproj/project.pbxproj"),
      ).text(),
      Bun.file(
        resolve(packageRoot, "ios/App/App/BridgeViewController.swift"),
      ).text(),
      Bun.file(
        resolve(packageRoot, "ios/App/App/RevenueCatPurchasePlugin.swift"),
      ).text(),
      Bun.file(
        resolve(packageRoot, "../app/src/utils/billingPurchaseTrace.ts"),
      ).text(),
    ]);

  expect(project).toMatch(
    /Begin PBXSourcesBuildPhase[\s\S]*RevenueCatPurchasePlugin\.swift in Sources[\s\S]*End PBXSourcesBuildPhase/,
  );
  expect(bridgeController).toContain(
    "bridge?.registerPluginInstance(RevenueCatPurchasePlugin())",
  );
  expect(purchasePlugin).toContain('let jsName = "RevenueCatPurchase"');
  expect(purchasePlugin).toContain(
    "nativeError.domain == ErrorCode.errorDomain",
  );
  expect(purchasePlugin).toContain("Self.reject(call, error: error)");
  expect(purchasePlugin).toContain(
    "package.storeProduct.productIdentifier == productId",
  );
  expect(purchasePlugin).toContain(
    'CAPPluginMethod(name: "preparePackage", returnType: CAPPluginReturnPromise)',
  );
  expect(purchasePlugin).toContain(
    'CAPPluginMethod(name: "purchasePackage", returnType: CAPPluginReturnPromise)',
  );
  expect(purchasePlugin).toContain(
    "preparedPackages.removeValue(forKey: packageId)",
  );
  expect(purchasePlugin).toContain(
    "preparedPackages.removeAll(keepingCapacity: true)",
  );
  expect(purchasePlugin).toContain(
    "candidate.userInfo[NSUnderlyingErrorKey] as? NSError",
  );
  expect(purchasePlugin).toContain('"bridge-invalid"');
  expect(purchasePlugin).toContain('"native-error"');
  expect(purchasePlugin).toContain('["userCancelled": userCancelled]');
  expect(purchasePlugin).toContain('data["storeError"] = storeError');
  expect(purchasePlugin).toContain(
    '["domain": candidate.domain, "code": candidate.code]',
  );
  const swiftDomainBlock = requiredMatch(
    purchasePlugin,
    /private static func isStoreDiagnosticDomain[\s\S]*?return \[([\s\S]*?)\]\.contains\(domain\)/,
    "Swift diagnostic domains",
  );
  const traceDomainBlock = requiredMatch(
    billingPurchaseTrace,
    /const NATIVE_ERROR_DOMAINS[\s\S]*?= \[([\s\S]*?)\];/,
    "TypeScript diagnostic domains",
  );
  const swiftDomains = [...swiftDomainBlock.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
  const traceDomains = [...traceDomainBlock.matchAll(/\["([^"]+)",/g)]
    .map((match) => match[1])
    .sort();

  expect(swiftDomains).toEqual(traceDomains);
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
    /"identity" : "purchases-ios-spm",[\s\S]*?"state" : \{[^{}]*"version" : "([^"]+)"[^{}]*\}\s*\}/,
    "resolved RevenueCat package version",
  );

  expect(
    packageResolution.match(/"identity" : "purchases-ios-spm"/g) ?? [],
  ).toHaveLength(1);
  expect(
    packageResolution.match(/"identity" : "purchases-hybrid-common"/g) ?? [],
  ).toHaveLength(1);
  expect(projectVersion).toBe(resolvedVersion);
});

test("Android registers a bounded RevenueCat purchase plugin", async () => {
  const [
    appBuild,
    mainActivity,
    purchasePlugin,
    revenueCatPluginBuild,
    runtime,
    variables,
  ] = await Promise.all([
    Bun.file(resolve(packageRoot, "android/app/build.gradle")).text(),
    Bun.file(
      resolve(
        packageRoot,
        "android/app/src/main/java/com/tearleads/app/MainActivity.java",
      ),
    ).text(),
    Bun.file(
      resolve(
        packageRoot,
        "android/app/src/main/java/com/tearleads/app/RevenueCatPurchasePlugin.kt",
      ),
    ).text(),
    Bun.file(
      resolve(
        packageRoot,
        "node_modules/@revenuecat/purchases-capacitor/android/build.gradle",
      ),
    ).text(),
    Bun.file(resolve(packageRoot, "src/capacitorRevenueCatRuntime.ts")).text(),
    Bun.file(resolve(packageRoot, "android/variables.gradle")).text(),
  ]);

  const purchasesVersion = requiredMatch(
    variables,
    /revenueCatPurchasesVersion = '([^']+)'/,
    "pinned Android RevenueCat purchases version",
  );
  const hybridCommonVersion = requiredMatch(
    variables,
    /revenueCatHybridCommonVersion = '([^']+)'/,
    "pinned Android RevenueCat hybrid version",
  );
  const pluginHybridCommonVersion = requiredMatch(
    revenueCatPluginBuild,
    /com\.revenuecat\.purchases:purchases-hybrid-common:([^'"]+)/,
    "Capacitor plugin RevenueCat hybrid version",
  );
  const replacementModeBlock = requiredMatch(
    purchasePlugin,
    /private fun replacementMode[\s\S]*?= when \(name\) \{([\s\S]*?)\n {4}\}/,
    "Android RevenueCat replacement modes",
  );
  const kotlinReplacementModes = [
    ...replacementModeBlock.matchAll(/"([^"]+)" -> StoreReplacementMode\./g),
  ]
    .map((match) => match[1])
    .sort();
  const capacitorReplacementModes = Object.values(STORE_REPLACEMENT_MODE)
    .map(String)
    .sort();

  expect(mainActivity).toContain(
    "registerPlugin(RevenueCatPurchasePlugin.class)",
  );
  expect(appBuild).toMatch(
    /implementation "com\.revenuecat\.purchases:purchases:\$\{rootProject\.ext\.revenueCatPurchasesVersion\}"/,
  );
  expect(appBuild).toContain("resolutionStrategy.eachDependency");
  expect(appBuild).toContain("requestedVersion != null");
  expect(appBuild).toContain("requestedVersion != expectedVersion");
  expect(purchasesVersion).toMatch(/^\d+\.\d+\.\d+$/);
  expect(hybridCommonVersion).toBe(pluginHybridCommonVersion);
  expect(purchasePlugin).toContain(
    '@CapacitorPlugin(name = "RevenueCatPurchase")',
  );
  expect(runtime).toContain('"RevenueCatPurchase"');
  expect(purchasePlugin).toContain("@PluginMethod\n    fun preparePackage");
  expect(purchasePlugin).toContain("@PluginMethod\n    fun purchasePackage");
  expect(purchasePlugin).toContain("preparedPackages[packageId] = prepared");
  expect(purchasePlugin).toContain("preparedPackages.clear()");
  expect(purchasePlugin).toContain("preparedPackages.remove(packageId)");
  expect(purchasePlugin).toContain("Purchases.sharedInstance.purchase(");
  expect(purchasePlugin.match(/\.getOfferings\(/g) ?? []).toHaveLength(1);
  expect(purchasePlugin).toContain(
    "StoreReplacementMode.CHARGE_PRORATED_PRICE",
  );
  expect(capacitorReplacementModes).toEqual(EXPECTED_ANDROID_REPLACEMENT_MODES);
  expect(kotlinReplacementModes).toEqual(EXPECTED_ANDROID_REPLACEMENT_MODES);
  expect(purchasePlugin).toContain(
    'JSObject().put("userCancelled", userCancelled)',
  );
});
