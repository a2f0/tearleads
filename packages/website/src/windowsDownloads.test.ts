import { expect, test } from "bun:test";
import { resolveWindowsDownloads } from "./windowsDownloads";

for (const staging of [false, true]) {
  test(`resolves the ${staging ? "staging" : "production"} Windows ZIP and checksum`, async () => {
    const prefix = `${staging ? "canary" : "stable"}-win-x64`;
    const app = staging ? "Tearleads-canary" : "Tearleads";
    const installer = `${prefix}-${"a".repeat(64)}-${app}-Setup.zip`;
    const links = await resolveWindowsDownloads(staging, async (url) => {
      expect(url).toEndWith(`${prefix}-download.json`);
      return Response.json({ installer, checksum: `${installer}.sha256` });
    });
    expect(links?.installerUrl).toEndWith(installer);
    expect(links?.checksumUrl).toBe(`${links?.installerUrl}.sha256`);
  });
}

test("unavailable and invalid Windows discovery never create broken download links", async () => {
  expect(
    await resolveWindowsDownloads(false, async () => {
      throw new Error("offline");
    }),
  ).toBeNull();
  for (const installer of [
    "https://untrusted.example/setup.zip",
    "../setup.zip",
    `canary-win-x64-${"a".repeat(64)}-Tearleads-canary-Setup.zip`,
    `stable-linux-x64-${"a".repeat(64)}-Tearleads-Setup.zip`,
  ]) {
    expect(
      await resolveWindowsDownloads(false, async () =>
        Response.json({ installer, checksum: `${installer}.sha256` }),
      ),
    ).toBeNull();
  }
});
