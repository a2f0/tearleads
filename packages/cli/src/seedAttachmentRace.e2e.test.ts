import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import {
  continuityDocuments,
  loadContinuityAssets,
  writeContinuityDocument,
} from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test("a retry preserves an avatar another device uploads while the seed asset is being read", async () => {
  await initializeApiDatabase();
  let interrupt = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      interrupt && new URL(req.url).pathname === "/blobs/stages/multipart"
        ? new Response(null, { status: 503 })
        : routeApp.fetch(req),
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
    const { spec, readAttachment } = await loadContinuityAssets();
    const document = continuityDocuments(spec)[0];
    if (!document) throw new Error("Missing fixture contact");
    await onFreshDevice(device, async ([store], sdk) => {
      const snapshot = store?.getSnapshot();
      const id = snapshot?.documentId;
      const attachment = snapshot?.attachments[0];
      if (!id || !attachment) throw new Error("Missing partial avatar");
      const localId = await sdk.documents.findLocalIdByDocumentId(id);
      if (!localId) throw new Error("Missing contact alias");
      const summary = await sdk.containerContents
        .documentQueries()
        .loadDocumentSummary(localId);
      if (!summary?.containerId) throw new Error("Missing contact placement");
      const repaired = await writeContinuityDocument({
        sdk,
        document,
        containerId: summary.containerId,
        localId,
        existing: { localId, documentId: id },
        readAttachment: async (name) => {
          await onFreshDevice(device, async ([other]) => {
            if (!other) throw new Error("Missing remote contact");
            await other.replaceAttachment(attachment.slotId, {
              name: "personal.png",
              mimeType: "image/png",
              bytes: new Uint8Array([7, 8, 9]),
            });
            expect(await other.requestRemoteSyncAndWait()).toBe(true);
          });
          return readAttachment(name);
        },
      });
      expect(repaired.getSnapshot().attachments[0]?.name).toBe("personal.png");
    });
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
