import { expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import {
  addDocumentAttachments,
  type DocumentStore,
  deriveStableDocumentId,
  writeStoredDocumentFields,
} from "@tearleads/client-sdk";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  continuityDocuments,
  continuitySeedTag,
  ensureContactsContainer,
  loadContinuityAssets,
  prepareContinuityAttachments,
} from "app/continuity";
import { runCli } from "./cli";
import { testContext } from "./cli.testUtils";
import { loadFolderTree } from "./folderTree";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { resolveSeedAccount, seedLocalId } from "./seedAccount";
import { publishSeedEdit } from "./seedAttachmentMetadata.testUtils";
import { type CliSession, withSession } from "./session";

const REFUSAL = "cannot confirm it created that document";

async function openSeedContact(session: CliSession, documentId: string) {
  const { sdk } = session;
  const contactsId = await ensureContactsContainer(sdk);
  const rows =
    await sdk.containerContents.discoverContainerDocuments(contactsId);
  const row = rows?.find((item) => item.documentId === documentId);
  if (!row) throw new Error("Missing seed contact");
  const store = sdk.containerContents.documentLinks().openDocument({
    containerId: contactsId,
    documentId,
    localId: row.id,
  });
  expect(await store.ensureInitialized()).toBe(true);
  expect(await store.requestRemoteSyncAndWait()).toBe(true);
  return store;
}

/** Rename the seeded contact from another device signed in to the account. */
async function editOnSecondDevice(
  device: { apiBaseUrl: string; recoveryKey: string },
  documentId: string,
  nickname: string,
  check?: (store: DocumentStore) => void,
) {
  await withSession(
    { ...device, documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS },
    async (session) => {
      await loadFolderTree(session);
      const store = await openSeedContact(session, documentId);
      check?.(store);
      expect(store.getSnapshot().canWrite).toBe(true);
      await store.setStructuredFields("contact", { nickname });
      expect(await store.requestRemoteSyncAndWait()).toBe(true);
      session.assertNoFailures();
    },
  );
}

async function startApi(failUpload: () => boolean, failCreate: () => boolean) {
  await initializeApiDatabase();
  const stages = { attempted: 0, opened: 0 };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      const stage = path === "/blobs/stages/multipart";
      if (stage) stages.attempted++;
      if (stage && failUpload()) return new Response(null, { status: 503 });
      if (path === "/documents" && request.method === "POST" && failCreate())
        return new Response(null, { status: 503 });
      const response = await routeApp.fetch(request);
      if (stage && response.ok) stages.opened++;
      return response;
    },
  });
  const apiBaseUrl = server.url.origin;
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  const { context, keyStore, output } = testContext({ apiBaseUrl });
  await keyStore.save("staging", seedPhrase);
  return {
    device: { apiBaseUrl, recoveryKey: seedPhrase },
    output,
    seed: () => runCli(["seed", "--env", "staging"], context),
    server,
    stages,
  };
}

test("a later edit that copies the fixture marker cannot stand in for the founding update", async () => {
  const api = await startApi(
    () => false,
    () => false,
  );
  try {
    const { spec, readAttachment, datasetSha256 } =
      await loadContinuityAssets();
    const document = continuityDocuments(spec)[0];
    if (document?.key !== "contact/0" || !document.attachments.length)
      throw new Error("Missing the Continuity avatar fixture");
    let documentId = "";
    let seedTag = "";
    await withSession(
      { ...api.device, documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS },
      async (session) => {
        const { sdk } = session;
        const { rootId, signingPrivateKey } = await resolveSeedAccount(
          session,
          undefined,
        );
        const localId = seedLocalId(
          signingPrivateKey,
          rootId,
          datasetSha256,
          document.key,
        );
        documentId = await deriveStableDocumentId(localId);
        // The founding update holds the document kind and nothing else.
        const receipt = await sdk.documents.createSeeded({
          containerId: await ensureContactsContainer(sdk),
          documentId,
          initialDocumentKind: "contact",
        });
        if (receipt === "purged") throw new Error("Unexpected purge");
        const store = await openSeedContact(session, documentId);
        const prepared = await prepareContinuityAttachments({
          localId,
          document,
          readAttachment,
        });
        seedTag = continuitySeedTag(document, prepared);
        // A signed later edit carries the marker, fields, and upload intent.
        await publishSeedEdit(sdk, store, (doc) => {
          doc.getMap("content").set("seedTag", seedTag);
          writeStoredDocumentFields(
            doc,
            "contact",
            document.fields ?? {},
            APP_DOCUMENT_PROJECTOR_DEFINITIONS,
          );
          addDocumentAttachments(
            doc,
            prepared.map(({ intent }) => intent),
          );
        });
        expect(await store.requestRemoteSyncAndWait()).toBe(true);
        const current = store.getSnapshot();
        expect(current.seedTag).toBe(seedTag);
        expect(current.attachments).toEqual(
          prepared.map(({ intent }) => intent),
        );
        expect(current.attachmentStorageKeyBySlotId).toEqual({});
      },
    );

    expect(await api.seed()).toBe(1);
    expect(api.output.stderr.at(-1)).toContain(
      `Seed did not add files to ${document.key} because it ${REFUSAL}`,
    );
    expect(api.stages.attempted).toBe(0);
    // The refusal stops only the importer: any device still reads and writes.
    await editOnSecondDevice(
      api.device,
      documentId,
      "Edited after refusal",
      (store) => expect(store.getSnapshot().seedTag).toBe(seedTag),
    );
  } finally {
    api.server.stop(true);
  }
}, 60_000);

test("a retry resumes uploads into its founded document after a second device edits it", async () => {
  let failUpload = true;
  let failCreate = false;
  const api = await startApi(
    () => failUpload,
    () => failCreate,
  );
  try {
    const { spec, readAttachment } = await loadContinuityAssets();
    const document = continuityDocuments(spec)[0];
    const avatar = document?.attachments[0];
    if (document?.key !== "contact/0" || !avatar)
      throw new Error("Missing the Continuity avatar fixture");
    // The importer creates the contact, then its avatar upload fails.
    expect(await api.seed()).toBe(1);
    expect(api.stages.attempted).toBeGreaterThan(0);
    expect(api.stages.opened).toBe(0);
    let documentId = "";
    await withSession(
      { ...api.device, documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS },
      async (session) => {
        await loadFolderTree(session);
        const rows =
          await session.sdk.containerContents.discoverContainerDocuments(
            await ensureContactsContainer(session.sdk),
          );
        expect(rows).toHaveLength(1);
        documentId = rows?.[0]?.documentId ?? "";
      },
    );
    const nickname = "Edited on a second device";
    await editOnSecondDevice(api.device, documentId, nickname);

    // Stop the retry at the next fixture's create.
    failUpload = false;
    failCreate = true;
    expect(await api.seed()).toBe(1);
    expect(api.output.stderr.join("\n")).not.toContain(REFUSAL);
    expect(api.stages.opened).toBe(1);
    await withSession(
      { ...api.device, documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS },
      async (session) => {
        await loadFolderTree(session);
        const store = await openSeedContact(session, documentId);
        const snapshot = store.getSnapshot();
        expect(snapshot.structuredFields).toMatchObject({
          ...document.fields,
          nickname,
        });
        const slot = snapshot.attachments[0];
        const key = slot && snapshot.attachmentStorageKeyBySlotId[slot.slotId];
        expect(slot?.name).toBe(avatar.file);
        if (!key) throw new Error("Missing resumed avatar");
        expect(await session.sdk.blobs.store.readBytes(key)).toEqual(
          await readAttachment(avatar.file),
        );
        session.assertNoFailures();
      },
    );
  } finally {
    api.server.stop(true);
  }
}, 60_000);
