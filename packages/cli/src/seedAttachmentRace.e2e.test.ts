import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test("a retry preserves an avatar another device commits after the seed document was read", async () => {
  await initializeApiDatabase();
  let interrupt = true;
  let beforeUpload: (() => Promise<void>) | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      if (new URL(req.url).pathname === "/blobs/stages/multipart") {
        if (interrupt) return new Response(null, { status: 503 });
        const edit = beforeUpload;
        beforeUpload = undefined;
        await edit?.();
      }
      return routeApp.fetch(req);
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { rootContainerId, seedPhrase } =
      await registerCliTestAccount(apiBaseUrl);
    const device = { apiBaseUrl, rootContainerId, recoveryKey: seedPhrase };
    const { context, keyStore } = testContext({ apiBaseUrl });
    await keyStore.save("staging", seedPhrase);
    expect(await runCli(["seed", "--env", "staging"], context)).toBe(1);
    interrupt = false;
    beforeUpload = () =>
      onFreshDevice(device, async ([other]) => {
        const attachment = other?.getSnapshot().attachments[0];
        if (!other || !attachment) throw new Error("Missing partial avatar");
        await other.replaceAttachment(attachment.slotId, {
          name: "personal.png",
          mimeType: "image/png",
          bytes: new Uint8Array([7, 8, 9]),
        });
        expect(await other.requestRemoteSyncAndWait()).toBe(true);
      });
    expect(await runCli(["seed", "--env", "staging"], context)).toBe(1);
    expect(beforeUpload).toBeUndefined();
    await onFreshDevice(device, async ([store], sdk) => {
      const snapshot = store?.getSnapshot();
      const attachment = snapshot?.attachments[0];
      expect(attachment?.name).toBe("personal.png");
      const key =
        snapshot?.attachmentStorageKeyBySlotId[attachment?.slotId ?? ""];
      expect(await sdk.blobs.store.readBytes(key ?? "")).toEqual(
        new Uint8Array([7, 8, 9]),
      );
    });
  } finally {
    server.stop(true);
  }
}, 60_000);
