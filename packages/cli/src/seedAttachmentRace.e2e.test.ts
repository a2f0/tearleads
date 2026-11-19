import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test.each(["replace", "remove"] as const)(
  "a retry respects a concurrent avatar %s after discovering a partial upload",
  async (edit) => {
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
      let contactId: string | null = null;
      beforeUpload = () =>
        onFreshDevice(device, async ([other]) => {
          const attachment = other?.getSnapshot().attachments[0];
          if (!other || !attachment) throw new Error("Missing partial avatar");
          contactId = other.getSnapshot().documentId;
          if (edit === "remove")
            await other.removeAttachment(attachment.slotId);
          else
            await other.replaceAttachment(attachment.slotId, {
              name: "personal.png",
              mimeType: "image/png",
              bytes: new Uint8Array([7, 8, 9]),
            });
          expect(await other.requestRemoteSyncAndWait()).toBe(true);
        });
      const result = await runCli(["seed", "--env", "staging"], context);
      expect(result).toBe(edit === "remove" ? 0 : 1);
      expect(beforeUpload).toBeUndefined();
      await onFreshDevice(device, async (stores, sdk) => {
        const store = stores.find(
          (candidate) => candidate.getSnapshot().documentId === contactId,
        );
        const snapshot = store?.getSnapshot();
        if (!snapshot?.documentId)
          throw new Error("Missing partial avatar owner");
        if (edit === "remove") {
          expect(snapshot.attachments).toHaveLength(0);
          const runtime = sdk.documents.workflowRuntime();
          expect(
            await runtime.apiClient.listDocumentAttachments(
              snapshot.documentId,
            ),
          ).toEqual([]);
          return;
        }
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
  },
  60_000,
);

test("a device can sync removal of its unbound avatar after seed has returned", async () => {
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
    const seed = () => runCli(["seed", "--env", "staging"], context);
    expect(await seed()).toBe(1);
    interrupt = false;
    await onFreshDevice(device, async ([store], sdk) => {
      const snapshot = store?.getSnapshot();
      const avatar = snapshot?.attachments[0];
      if (!store || !avatar || !snapshot?.documentId)
        throw new Error("Missing partial contact");
      const links = sdk.containerContents.documentLinks();
      const queries = sdk.containerContents.documentQueries();
      const id = await sdk.documents.findLocalIdByDocumentId(
        snapshot.documentId,
      );
      const summary = await queries.loadDocumentSummary(id ?? "");
      if (!summary?.containerId) throw new Error("Missing contact placement");
      expect(
        snapshot.attachmentStorageKeyBySlotId[avatar.slotId],
      ).toBeUndefined();
      sdk.network.setOnline(false);
      store.updateRuntime(
        sdk.containerContents
          .documentLinks()
          .documentRuntime(summary.containerId),
      );
      await store.removeAttachment(avatar.slotId);
      expect(store.getSnapshot().attachments).toHaveLength(0);
      expect(await seed()).toBe(0);
      sdk.network.setOnline(true);
      store.updateRuntime(
        sdk.containerContents
          .documentLinks()
          .documentRuntime(summary.containerId),
      );
      expect(await store.requestRemoteSyncAndWait()).toBe(true);
      const bindings = await links
        .documentRuntime(summary.containerId)
        .apiClient.listDocumentAttachments(snapshot.documentId, {
          refresh: true,
        });
      expect(bindings?.map((binding) => binding.slotId)).toEqual([]);
    });
  } finally {
    server.stop(true);
  }
}, 90_000);
