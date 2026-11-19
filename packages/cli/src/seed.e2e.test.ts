import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { getOrCreateDomainSyncCoordinator } from "@tearleads/client-sdk";
import {
  continuityDocuments,
  loadContinuityAssets,
  writeContinuityDocument,
} from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test("seed uploads the pinned dataset and a fresh device can read it", async () => {
  await initializeApiDatabase();
  let interruptUpload = true;
  const contentRequests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      if (/^\/(containers|documents|blobs)\//u.test(path))
        contentRequests.push(path);
      if (
        interruptUpload &&
        new URL(request.url).pathname === "/blobs/stages/multipart"
      )
        return new Response("unavailable", { status: 503 });
      return routeApp.fetch(request);
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase, rootContainerId } =
      await registerCliTestAccount(apiBaseUrl);
    const { context, keyStore, output } = testContext({ apiBaseUrl });
    await keyStore.save("staging", seedPhrase);
    contentRequests.length = 0;
    expect(
      await runCli(
        ["seed", "--env", "staging", "--org", crypto.randomUUID()],
        context,
      ),
    ).toBe(1);
    expect(output.stderr).toEqual([
      "Seed requires the signed-in account's personal organization.",
    ]);
    expect(contentRequests).toEqual([]);
    output.stderr.length = 0;
    const { spec, readAttachment } = await loadContinuityAssets();
    const documents = continuityDocuments(spec);
    const run = async () => {
      const result = await runCli(["seed", "--env", "staging"], context);
      expect(output.stderr).toEqual([]);
      expect(result).toBe(0);
      expect(output.stdout.at(-1)).toBe(
        `Synced ${documents.length} Continuity documents to your staging account.`,
      );
    };
    expect(await runCli(["seed", "--env", "staging"], context)).toBe(1);
    expect(output.stderr.join("\n")).toContain("/blobs/stages/multipart");
    expect(output.stdout).toEqual([]);
    const device = { apiBaseUrl, recoveryKey: seedPhrase, rootContainerId };
    await onFreshDevice(device, async (stores, sdk) => {
      const avatar = spec.contacts?.[0]?.avatar;
      if (!avatar) throw new Error("Missing Continuity avatar");
      const store = stores.find((store) =>
        store.getSnapshot().attachments.some((a) => a.name === avatar.file),
      );
      const partial = store?.getSnapshot();
      const document = documents.find((item) => item.key === "contact/0");
      if (!partial?.documentId || !document || !store)
        throw new Error("Missing partially uploaded contact");
      expect(partial.documentKind).toBe("contact");
      expect(partial.attachmentStorageKeyBySlotId).toEqual({});
      const localId = await sdk.documents.findLocalIdByDocumentId(
        partial.documentId,
      );
      if (!localId) throw new Error("Missing contact alias");
      const summary = await sdk.containerContents
        .documentQueries()
        .loadDocumentSummary(localId);
      if (!summary?.containerId) throw new Error("Missing contact placement");
      // A retry with bytes that differ from the recorded intent must leave
      // that intent available for recovery by its original writer.
      await expect(
        writeContinuityDocument({
          destination: "account",
          sdk,
          localId,
          containerId: summary.containerId,
          document,
          existing: { localId, documentId: partial.documentId },
          readAttachment: async () => new Uint8Array([1, 2, 3]),
        }),
      ).rejects.toThrow("Could not recover edited attachment");
      expect(store.getSnapshot().attachments).toEqual(partial.attachments);
    });
    interruptUpload = false;
    output.stderr.length = 0;
    await run();
    const editedName = "Personal weight journal";
    const editedNotes = "Edited on a second device";
    let additionalFolderId = "";
    await onFreshDevice(device, async (stores, sdk) => {
      const tracker = stores.find(
        (store) => store.getSnapshot().documentKind === "weight",
      );
      const row = tracker?.getSnapshot().rows[0];
      if (!tracker || !row) throw new Error("Missing weight tracker row");
      await tracker.setStructuredFields("weight", { trackerName: editedName });
      await tracker.updateRowFields(row.id, { notes: editedNotes });
      expect(await tracker.requestRemoteSyncAndWait()).toBe(true);
      if (!rootContainerId) throw new Error("Missing root");
      const folder = await sdk.containerContents
        .openTree()
        .createChild(rootContainerId, "Health");
      if (!folder) throw new Error("Could not create Health folder");
      additionalFolderId = folder.id;
      const coordinator = getOrCreateDomainSyncCoordinator(
        sdk.runtime.input().state.domainScope,
      );
      expect(await coordinator.waitForIdle({ timeoutMs: 30_000 })).toBe(true);
      const id = await sdk.documents.findLocalIdByDocumentId(
        tracker.getSnapshot().documentId ?? "",
      );
      const note = await sdk.containerContents
        .documentQueries()
        .loadDocumentSummary(id ?? "");
      if (!note) throw new Error("Missing tracker summary");
      const moved = await sdk.containerContents
        .documentLinks()
        .moveDocumentToContainer({
          note,
          targetContainerId: folder.id,
          replaceLinkedContainers: true,
          expandNode: () => {},
          mergeDocumentSummary: () => {},
          setLinkedContainerIdsForDocument: () => {},
        });
      expect(moved.note?.containerId).toBe(folder.id);
      expect(await coordinator.waitForIdle({ timeoutMs: 30_000 })).toBe(true);
    });
    await run();
    await onFreshDevice(
      { ...device, additionalFolderId },
      async (stores, sdk) => {
        const found = stores.map((store) => store.getSnapshot());
        const tracker = found.find(
          (snapshot) => snapshot.documentKind === "weight",
        );
        const id = await sdk.documents.findLocalIdByDocumentId(
          tracker?.documentId ?? "",
        );
        const moved = await sdk.containerContents
          .documentQueries()
          .loadDocumentSummary(id ?? "");
        expect(moved?.containerId).toBe(additionalFolderId);
        for (const snapshot of found) {
          for (const attachment of snapshot.attachments) {
            const key =
              snapshot.attachmentStorageKeyBySlotId[attachment.slotId];
            expect(key).toBeDefined();
            expect(await sdk.blobs.store.readBytes(key ?? "")).toEqual(
              await readAttachment(attachment.name),
            );
          }
        }
        expect(found.length).toBe(documents.length);
        for (const document of documents) {
          expect(found).toContainEqual(
            expect.objectContaining({
              documentKind: document.kind,
              text: document.text ?? "",
              structuredFields: expect.objectContaining(
                document.kind === "weight"
                  ? { ...document.fields, trackerName: editedName }
                  : (document.fields ?? {}),
              ),
              rows: (document.rows ?? []).map((fields, index) =>
                expect.objectContaining({
                  fields:
                    document.kind === "weight" && index === 0
                      ? { ...fields, notes: editedNotes }
                      : fields,
                }),
              ),
              attachments: expect.arrayContaining(
                document.attachments.map(({ file: name }) =>
                  expect.objectContaining({ name }),
                ),
              ),
            }),
          );
        }
      },
    );
  } finally {
    server.stop(true);
  }
}, 240_000);
