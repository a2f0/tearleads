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
    // These edits land while the importer's bind is in flight, after the
    // importer pulled to check the slot, so the API refuses that bind.
    const raceBind = ["interrupted removal", "restore", "rename"].includes(
      edit,
    );
    let lostBind = false;
    let refusedBinds = 0;
    let afterRefusal: (() => Promise<void>) | undefined;
    let beforeUpload: (() => Promise<void>) | undefined;
    // Requests the other device makes inside a hook, and every request after
    // the raced run, pass straight through.
    let hooking = false;
    let racing = true;
    const runHook = async (hook: (() => Promise<void>) | undefined) => {
      hooking = true;
      try {
        await hook?.();
      } finally {
        hooking = false;
      }
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) => {
        const path = new URL(req.url).pathname;
        if (hooking) return routeApp.fetch(req);
        const stage = path === "/blobs/stages/multipart";
        if (stage && interrupt) return new Response(null, { status: 503 });
        if (!racing) return routeApp.fetch(req);
        const bind = path.endsWith("/attachment-bindings");
        if (raceBind ? bind : stage) {
          const edit = beforeUpload;
          beforeUpload = undefined;
          await runHook(edit);
        }
        if (!raceBind || !bind) return routeApp.fetch(req);
        const response = await routeApp.fetch(req);
        if (response.status === 409) {
          refusedBinds += 1;
          // The other device edits again before the importer re-checks.
          const edit = afterRefusal;
          afterRefusal = undefined;
          await runHook(edit);
          return response;
        }
        if (!response.ok || lostBind) return response;
        // The bind commits but its response is lost.
        lostBind = true;
        return new Response(null, { status: 503 });
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
            afterRefusal = () =>
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
                // The synced version still records the slot; this direct
                // detach is the test's own, not the store's reconciliation.
                documentVersionVector: other.getSnapshot().versionVector ?? "",
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
      racing = false;
      expect(result).toBe(1);
      expect(afterRefusal).toBeUndefined();
      expect(beforeUpload).toBeUndefined();
      expect(refusedBinds).toBe(raceBind ? 1 : 0);
      // Only a rename keeps asking for the fixture, so only its re-checked
      // bind commits (and loses its response).
      expect(lostBind).toBe(edit === "rename");
      if (edit === "interrupted removal") {
        await onFreshDevice(device, async ([store], sdk) => {
          expect(store?.getSnapshot().attachments).toHaveLength(0);
          const bindings = await sdk.documents
            .workflowRuntime()
            .apiClient.listDocumentAttachments(contactId ?? "");
          expect(bindings).toHaveLength(0);
        });
      }
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
          ).toHaveLength(0);
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
