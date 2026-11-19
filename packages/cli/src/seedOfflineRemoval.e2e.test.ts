import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test.each(["seed", "personal"] as const)(
  "delayed offline removal reconciles the %s avatar",
  async (upload) => {
    await initializeApiDatabase();
    let interrupt = true;
    let beforeDetach: (() => Promise<void>) | undefined;
    let personalBindingId: string | undefined;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) => {
        const path = new URL(req.url).pathname;
        if (interrupt && path === "/blobs/stages/multipart")
          return new Response(null, { status: 503 });
        if (path.endsWith("/detach")) {
          const restore = beforeDetach;
          beforeDetach = undefined;
          await restore?.();
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
      const seed = () => runCli(["seed", "--env", "staging"], context);
      expect(await seed()).toBe(1);
      interrupt = false;
      let contactId: string | null = null;
      const removal = onFreshDevice(device, async ([store], sdk) => {
        const snapshot = store?.getSnapshot();
        const avatar = snapshot?.attachments[0];
        if (!store || !avatar || !snapshot?.documentId)
          throw new Error("Missing partial contact");
        contactId = snapshot.documentId;
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
        if (upload === "personal") {
          // The remover has published its content edit by the time it sends
          // the detach. Restore from that revision before the API handles it.
          beforeDetach = () =>
            onFreshDevice(device, async (stores, otherSdk) => {
              const personal = stores.find(
                (item) => item.getSnapshot().documentId === contactId,
              );
              if (!personal) throw new Error("Missing contact");
              expect(personal.getSnapshot().attachments).toHaveLength(0);
              await personal.replaceAttachment(avatar.slotId, {
                name: "personal.png",
                mimeType: "image/png",
                bytes: new Uint8Array([7, 8, 9]),
              });
              expect(await personal.requestRemoteSyncAndWait()).toBe(true);
              const bindings = await otherSdk.documents
                .workflowRuntime()
                .apiClient.listDocumentAttachments(snapshot.documentId ?? "", {
                  refresh: true,
                });
              personalBindingId = bindings?.find(
                (item) => item.slotId === avatar.slotId,
              )?.bindingId;
              expect(personalBindingId).toBeDefined();
            });
        }
        sdk.network.setOnline(true);
        store.updateRuntime(
          sdk.containerContents
            .documentLinks()
            .documentRuntime(summary.containerId),
        );
        expect(await store.requestRemoteSyncAndWait()).toBe(true);
      });
      if (upload === "personal") {
        // The session reports the API's compare-and-swap rejection, including
        // the SDK's retry with a refreshed writer projection.
        await expect(removal).rejects.toThrow(
          /^The API did not answer completely, so the result may be partial:\n(?: {2}POST \/blobs\/[0-9a-f-]+\/attachment-bindings\/[0-9a-f-]+\/detach: 409 Conflict: Attachment binding is not active\n)+ {2}POST \/blobs\/\{blobId\}\/attachment-bindings\/\{bindingId\}\/detach failed \d+ time\(s\)$/,
        );
      } else {
        await removal;
      }
      await onFreshDevice(device, async (stores, sdk) => {
        const snapshot = stores
          .find((item) => item.getSnapshot().documentId === contactId)
          ?.getSnapshot();
        if (!snapshot?.documentId) throw new Error("Missing changed contact");
        const bindings = await sdk.documents
          .workflowRuntime()
          .apiClient.listDocumentAttachments(snapshot.documentId, {
            refresh: true,
          });
        expect(bindings?.map((binding) => binding.slotId)).toEqual(
          snapshot.attachments.map((item) => item.slotId),
        );
        const avatar = snapshot.attachments[0];
        if (upload === "seed") {
          expect(avatar).toBeUndefined();
        } else {
          expect(beforeDetach).toBeUndefined();
          if (!avatar) throw new Error("Personal avatar was removed");
          expect(bindings?.[0]?.bindingId).toBe(personalBindingId);
          expect(avatar.name).toBe("personal.png");
          expect(
            await sdk.blobs.store.readBytes(
              snapshot.attachmentStorageKeyBySlotId[avatar.slotId] ?? "",
            ),
          ).toEqual(new Uint8Array([7, 8, 9]));
        }
      });
    } finally {
      server.stop(true);
    }
  },
  90_000,
);
