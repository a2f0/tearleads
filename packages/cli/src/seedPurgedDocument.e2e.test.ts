import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import { getOrCreateDomainSyncCoordinator } from "@tearleads/client-sdk";
import { loadContinuityAssets } from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { onFreshDevice } from "./seedDevice.testUtils";

test("verified purges and moves to newly created folders survive a seed retry", async () => {
  await initializeApiDatabase();
  let uploads = 0;
  let limitUploads = true;
  let purgedId = "";
  let movedContactId = "";
  let additionalFolderId = "";
  let invalidateProof = false;
  let beforeMissingHead: (() => Promise<void>) | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      if (limitUploads && path === "/blobs/stages/multipart" && ++uploads > 1)
        return new Response(null, { status: 503 });
      const response = await routeApp.fetch(req);
      if (
        response.status === 404 &&
        path === `/documents/${purgedId}/writer-projection`
      ) {
        const move = beforeMissingHead;
        beforeMissingHead = undefined;
        await move?.();
      }
      if (
        invalidateProof &&
        response.ok &&
        path === `/documents/${purgedId}/purge`
      ) {
        const proof = await response.json();
        return Response.json({ ...proof, documentId: crypto.randomUUID() });
      }
      return response;
    },
  });
  try {
    const apiBaseUrl = server.url.origin;
    const { seedPhrase, rootContainerId } =
      await registerCliTestAccount(apiBaseUrl);
    const device = { apiBaseUrl, rootContainerId, recoveryKey: seedPhrase };
    const { context, keyStore, output } = testContext({ apiBaseUrl });
    await keyStore.save("staging", seedPhrase);
    const seed = () => runCli(["seed", "--env", "staging"], context);
    expect(await seed()).toBe(1);
    limitUploads = false;
    const firstAvatar = (await loadContinuityAssets()).spec.contacts?.[0]
      ?.avatar?.file;
    await onFreshDevice(device, async (stores, sdk) => {
      expect(stores).toHaveLength(2);
      const id = stores
        .find(
          (store) => store.getSnapshot().attachments[0]?.name === firstAvatar,
        )
        ?.getSnapshot().documentId;
      if (!id) throw new Error("Missing first fixture");
      purgedId = id;
      const localId = await sdk.documents.findLocalIdByDocumentId(id);
      const note = await sdk.containerContents
        .documentQueries()
        .loadDocumentSummary(localId ?? "");
      if (!note) throw new Error("Missing fixture placement");
      expect(
        (await sdk.containerContents.documentLinks().purgeDocument({ note }))
          ?.documentId,
      ).toBe(id);
    });
    invalidateProof = true;
    expect(await seed()).toBe(1);
    expect(output.stderr.at(-1)).toMatch(/purge|mismatch/i);
    invalidateProof = false;
    beforeMissingHead = () =>
      onFreshDevice(device, async ([contact], sdk) => {
        const id = contact?.getSnapshot().documentId;
        if (!id || !rootContainerId)
          throw new Error("Missing remaining contact");
        movedContactId = id;
        const localId = await sdk.documents.findLocalIdByDocumentId(id);
        const note = await sdk.containerContents
          .documentQueries()
          .loadDocumentSummary(localId ?? "");
        const folder = await sdk.containerContents
          .openTree()
          .createChild(rootContainerId, "Moved contacts");
        if (!note || !folder) throw new Error("Missing move endpoints");
        additionalFolderId = folder.id;
        const idle = () =>
          getOrCreateDomainSyncCoordinator(
            sdk.runtime.input().state.domainScope,
          ).waitForIdle({ timeoutMs: 30_000 });
        expect(await idle()).toBe(true);
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
        expect(await idle()).toBe(true);
      });
    expect(await seed(), output.stderr.join("\n")).toBe(0);
    expect(beforeMissingHead).toBeUndefined();
    expect(output.stdout.at(-1)).toBe(
      "Synced 24 Continuity documents to your staging account. Skipped 1 permanently deleted.",
    );
    await onFreshDevice(
      { ...device, movedContactId, additionalFolderId },
      async (stores) => {
        const ids = stores.map((store) => store.getSnapshot().documentId);
        expect(ids).toHaveLength(24);
        expect(ids).not.toContain(purgedId);
        expect(ids).toContain(movedContactId);
      },
    );
  } finally {
    server.stop(true);
  }
}, 120_000);
