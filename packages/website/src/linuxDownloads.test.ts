import { expect, test } from "bun:test";
import { resolveLinuxDownloads } from "./linuxDownloads";

for (const staging of [false, true]) {
  test(`resolves the ${staging ? "preview" : "production"} Linux installer`, async () => {
    const prefix = `${staging ? "canary" : "stable"}-linux-x64`;
    const app = staging ? "Tearleads-canary" : "Tearleads";
    const installer = `${prefix}-${"a".repeat(64)}-${app}-Setup.tar.gz`;
    const links = await resolveLinuxDownloads(staging, async (url) => {
      expect(url).toEndWith(`${prefix}-download.json`);
      return Response.json({ installer, checksum: `${installer}.sha256` });
    });
    expect(links.installerUrl).toEndWith(installer);
    expect(links.checksumUrl).toBe(`${links.installerUrl}.sha256`);
  });
}

for (const installer of [
  `stable-linux-arm64-${"a".repeat(64)}-Tearleads-Setup.tar.gz`,
  `canary-linux-x64-${"a".repeat(64)}-Tearleads-canary-Setup.tar.gz`,
  "https://untrusted.example/installer.tar.gz",
  "../installer.tar.gz",
]) {
  test(`rejects incorrect Linux discovery: ${installer}`, async () => {
    const fallback = await resolveLinuxDownloads(false, async () => {
      throw new Error("offline");
    });
    const links = await resolveLinuxDownloads(false, async () =>
      Response.json({ installer, checksum: `${installer}.sha256` }),
    );
    expect(links).toEqual(fallback);
    expect(links.checksumUrl).toBe(`${links.installerUrl}.sha256`);
  });
}
