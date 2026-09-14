import { expect, test } from "bun:test";
import { resolveMacosDownloads } from "./macosDownloads";

for (const staging of [true, false]) {
  test(`website resolves a matched immutable ${staging ? "staging" : "production"} release`, async () => {
    const prefix = `${staging ? "canary" : "stable"}-macos-arm64`;
    const app = staging ? "Tearleads-canary" : "Tearleads";
    const installer = `${prefix}-${"a".repeat(64)}-${app}.dmg`;
    const links = await resolveMacosDownloads(staging, async (url) => {
      expect(url).toEndWith(`${prefix}-download.json`);
      return Response.json({ installer, checksum: `${installer}.sha256` });
    });
    expect(links.installerUrl).toEndWith(installer);
    expect(links.checksumUrl).toBe(`${links.installerUrl}.sha256`);
  });
}

for (const response of [
  { installer: "https://untrusted.example/app.dmg", checksum: "wrong" },
  {
    installer: `stable-macos-arm64-${"b".repeat(64)}-Tearleads.dmg`,
    checksum: "wrong",
  },
  {},
]) {
  test(`invalid discovery preserves the verified fallback pair: ${JSON.stringify(response)}`, async () => {
    const links = await resolveMacosDownloads(false, async () =>
      Response.json(response),
    );
    expect(links.installerUrl).toContain(
      "5f346b3e19a09aa06af8d37330732858ec5cf14746c4e4c0abfcfd6fd510ff2a",
    );
    expect(links.checksumUrl).toBe(`${links.installerUrl}.sha256`);
  });
}

test("offline website builds retain a matched first-release download", async () => {
  const links = await resolveMacosDownloads(true, async () => {
    throw new Error("offline");
  });
  expect(links.installerUrl).toContain(
    "downloads-staging.tearleads.com/canary-macos-arm64-",
  );
  expect(links.checksumUrl).toBe(`${links.installerUrl}.sha256`);
});
