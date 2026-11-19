import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { resolveDocumentCreateAuthor } from "@tearleads/client-sdk";
import { continuityDocuments, loadContinuityAssets } from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { restoreAttachmentMetadata } from "./seedAttachmentMetadata.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test.each([
  "replace",
  "remove",
  "metadata",
  "restore",
  "rename",
  "interrupted removal",
] as const)(
  "a retry respects a concurrent avatar %s after discovering a partial upload",
  async (edit) => {
    await initializeApiDatabase();
    let interrupt = true;
    let loseBindResponse = edit === "interrupted removal";
    let lostBind = false;
    let beforeDetach: (() => Promise<void>) | undefined;
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
        if (new URL(req.url).pathname.endsWith("/detach")) {
          const restore = beforeDetach;
          beforeDetach = undefined;
          await restore?.();
        }
        if (
          loseBindResponse &&
          new URL(req.url).pathname.endsWith("/attachment-bindings")
        ) {
          const response = await routeApp.fetch(req);
          if (response.ok) {
            lostBind = true;
            return new Response(null, { status: 503 });
          }
          return response;
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
      let expectedBytes = new Uint8Array([7, 8, 9]);
      beforeUpload = () =>
        onFreshDevice(device, async ([other], sdk) => {
          const attachment = other?.getSnapshot().attachments[0];
          if (!other || !attachment) throw new Error("Missing partial avatar");
          contactId = other.getSnapshot().documentId;
          if (edit === "restore" || edit === "rename") {
            if (edit === "rename")
              expectedBytes = new Uint8Array(
                await (await loadContinuityAssets()).readAttachment(
                  attachment.name,
                ),
              );
            beforeDetach = () =>
              onFreshDevice(device, async ([restored], sdk) => {
                if (!restored) throw new Error("Missing edited contact");
                if (edit === "rename") {
                  await restoreAttachmentMetadata(sdk, restored, {
                    ...attachment,
                    name: "personal.png",
                  });
                  return;
                }
                await restored.replaceAttachment(attachment.slotId, {
                  name: "personal.png",
                  mimeType: "image/png",
                  bytes: new Uint8Array([7, 8, 9]),
                });
                expect(await restored.requestRemoteSyncAndWait()).toBe(true);
              });
          }
          if (
            edit === "remove" ||
            edit === "restore" ||
            edit === "rename" ||
            edit === "interrupted removal"
          )
            await other.removeAttachment(attachment.slotId);
          else
            await other.replaceAttachment(attachment.slotId, {
              name: "personal.png",
              mimeType: "image/png",
              bytes: new Uint8Array([7, 8, 9]),
            });
          expect(await other.requestRemoteSyncAndWait()).toBe(true);
          if (edit === "metadata") {
            const docId = other.getSnapshot().documentId;
            if (!docId) throw new Error("Missing remote contact");
            const runtime = sdk.documents.workflowRuntime();
            const author = resolveDocumentCreateAuthor(runtime);
            const bindings = await runtime.apiClient.listDocumentAttachments(
              docId,
              { refresh: true },
            );
            const binding = bindings?.find(
              (item) => item.slotId === attachment.slotId,
            );
            if (!binding || !author) throw new Error("Missing personal avatar");
            // Leave the signed changed document intact while its blob is absent.
            expect(
              await runtime.blobAttachments.detachDocumentAttachment({
                ...binding,
                author,
                documentId: docId,
                resolveProjectionUserKey:
                  sdk.containerContents.documentLinks()
                    .resolveProjectionUserKey,
                warmReferencedPrincipalPolicies:
                  runtime.principalPolicies.createWarmer(),
              }),
            ).toBeTruthy();
          }
        });
      const result = await runCli(["seed", "--env", "staging"], context);
      expect(result).toBe(
        edit === "replace" ||
          edit === "restore" ||
          edit === "interrupted removal"
          ? 1
          : 0,
      );
      expect(beforeDetach).toBeUndefined();
      expect(beforeUpload).toBeUndefined();
      if (edit === "interrupted removal") {
        expect(lostBind).toBe(true);
        loseBindResponse = false;
        await onFreshDevice(device, async ([store], sdk) => {
          expect(store?.getSnapshot().attachments).toHaveLength(0);
          const bindings = await sdk.documents
            .workflowRuntime()
            .apiClient.listDocumentAttachments(contactId ?? "");
          expect(bindings).toHaveLength(1);
        });
      }
      if (edit === "metadata" || edit === "interrupted removal")
        expect(await runCli(["seed", "--env", "staging"], context)).toBe(0);
      await onFreshDevice(device, async (stores, sdk) => {
        if (edit === "metadata")
          expect(stores).toHaveLength(
            continuityDocuments((await loadContinuityAssets()).spec).length,
          );
        const store = stores.find(
          (candidate) => candidate.getSnapshot().documentId === contactId,
        );
        const snapshot = store?.getSnapshot();
        if (!snapshot?.documentId)
          throw new Error("Missing partial avatar owner");
        if (edit === "remove" || edit === "interrupted removal") {
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
        if (edit === "metadata") {
          expect(
            await sdk.documents
              .workflowRuntime()
              .apiClient.listDocumentAttachments(snapshot.documentId, {
                refresh: true,
              }),
          ).toHaveLength(0);
          return;
        }
        const key =
          snapshot?.attachmentStorageKeyBySlotId[attachment?.slotId ?? ""];
        expect(key).toBeDefined();
        expect(await sdk.blobs.store.readBytes(key ?? "")).toEqual(
          expectedBytes,
        );
      });
    } finally {
      server.stop(true);
    }
  },
  60_000,
);
