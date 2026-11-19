import { expect } from "bun:test";
import {
  type DocumentStore,
  type DocumentSummary,
  deriveContainerSystemSlot,
  type Tearleads,
} from "@tearleads/client-sdk";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "app/continuity";
import { loadFolderTree } from "./folderTree";
import { withSession } from "./session";

export async function onFreshDevice(
  input: {
    additionalFolderId?: string;
    apiBaseUrl: string;
    recoveryKey: string;
    rootContainerId: string | null;
  },
  work: (stores: DocumentStore[], sdk: Tearleads) => Promise<void>,
) {
  await withSession(
    { ...input, documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS },
    async (session) => {
      const { sdk } = session;
      const { nodes } = await loadFolderTree(session);
      const keys = sdk.identity.signingKeyPair;
      if (!keys || !input.rootContainerId)
        throw new Error("Missing account root or keys");
      // Resolve the Contacts mini-app's system slot from the second device's
      // identity and the downloaded tree, without provisioning anything.
      const slot = await deriveContainerSystemSlot({
        definition: {
          namespace: "tearleads.contacts",
          projectorId: "contact",
          slotId: "contacts",
          version: 1,
        },
        secretKey: keys.signingPrivateKey,
      });
      const contacts = nodes.find(
        (node) =>
          node.systemSlot === slot &&
          node.parentId === input.rootContainerId &&
          node.organizationId === sdk.session.organizationId,
      )?.id;
      if (!contacts)
        throw new Error("Contacts folder missing from the personal root");
      const stores = [];
      for (const containerId of [
        input.rootContainerId,
        contacts,
        ...(input.additionalFolderId ? [input.additionalFolderId] : []),
      ]) {
        const rows = new Map<string, DocumentSummary>();
        for (;;) {
          const batch =
            await sdk.containerContents.discoverContainerDocuments(containerId);
          if (!batch) throw new Error("Could not discover fixture documents");
          if (!batch.length) break;
          for (const row of batch) rows.set(row.id, row);
        }
        for (const row of rows.values()) {
          const store = sdk.containerContents.documentLinks().openDocument({
            containerId,
            localId: row.id,
            documentId: row.documentId,
          });
          expect(await store.ensureInitialized()).toBe(true);
          expect(await store.requestRemoteSyncAndWait()).toBe(true);
          expect(store.getSnapshot().documentKind === "contact").toBe(
            containerId === contacts,
          );
          stores.push(store);
        }
      }
      await work(stores, sdk);
      session.assertNoFailures();
    },
  );
}
