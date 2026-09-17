import { expect, test } from "bun:test";

test("Capacitor sync preserves the iOS 18 floor with Swift 5.9-compatible syntax", async () => {
  const generated = await Bun.file(
    new URL("../ios/App/CapApp-SPM/Package.swift", import.meta.url),
  ).text();
  const cliSpm = await Bun.file(
    new URL("../node_modules/@capacitor/cli/dist/util/spm.js", import.meta.url),
  ).text();
  const cliPluginSpm = await Bun.file(
    new URL(
      "../node_modules/@capacitor/cli/dist/ios/update.js",
      import.meta.url,
    ),
  ).text();

  expect(generated).toContain("// swift-tools-version: 5.9");
  expect(generated).toContain('platforms: [.iOS("18.0")]');
  const versionPlaceholder = "$" + "{iosVersion}";
  expect(cliSpm).toContain(`platforms: [.iOS("${versionPlaceholder}.0")]`);
  expect(cliPluginSpm).toContain(
    `platforms: [.iOS("${versionPlaceholder}.0")]`,
  );
});
