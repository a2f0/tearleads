import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { deriveStableDocumentId } from "../../../../data/documents/shared/stableDocumentId";
import { disposeDomainSyncCoordinator } from "../../../../data/sync/syncCoordinator";
import {
  defaultDocumentsPersistence,
  reclaimDocumentOrphanBlobs,
} from "../../../../workflows/documents";
import { createDocumentStore, openDocumentStore } from "../index";
import {
  ensureDeferredBirthSchema,
  offlineAttachRuntime,
} from "./deferredInitialUpdate.testFixtures";

const CONTACT_FIELDS = { firstName: "Ada", lastName: "Lovelace", nickname: "" };
const ADDRESS_FIELDS = { label: "Home", street: "12 Existing Street" };

async function readDurableState(
  execSql: ReturnType<typeof createNativeTestExecSql>["execSql"],
  localId: string,
) {
  const [document, history, pending] = await Promise.all([
    defaultDocumentsPersistence.loadDocument(execSql, localId),
    defaultDocumentsPersistence.loadHistoryRestoreState(execSql, localId),
    defaultDocumentsPersistence.listPendingUpdates(execSql, localId),
  ]);
  return { document, history, pending };
}

// Native in-memory SQLite exercises the real persistence and backing stores,
// not the encrypted WASM engine or an authenticated server/adoption protocol.
// The reverse order already has a control in documentsPersistence.behavior.test:
// "upsertDiscoveredDocument defers a pending-create row until verified adoption".
test("discovery first preserves alias content and blocks an unverified second birth", async () => {
  const { close, execSql } = createNativeTestExecSql();
  const runtime = offlineAttachRuntime({
    blobStore: createMemoryBlobStore(),
    canAttach: false,
    execSql,
  });
  const localId = "self_contact_v1_discovery_first";
  const documentId = await deriveStableDocumentId(localId);
  const persistence = defaultDocumentsPersistence;

  try {
    await ensureDeferredBirthSchema(execSql);
    // Discovery knows D, but has never seen the deterministic local key L.
    const discovered = await persistence.upsertDiscoveredDocument(execSql, {
      accessEpoch: 1,
      containerId: "container",
      createdAt: "2026-11-01T00:00:00.000Z",
      documentId,
      effectiveAccessLevel: "write",
      linkedContainerIds: ["container"],
    });
    expect(discovered).toMatchObject({ id: documentId, documentId });
    expect(await readDurableState(execSql, localId)).toEqual({
      document: null,
      history: null,
      pending: [],
    });

    // Give the discovered alias real locally retained content through ordinary
    // store mutations. No raw SQL seeding, fabricated history, or fake adoption.
    const alias = openDocumentStore(
      runtime.state.domainScope,
      documentId,
      runtime,
      documentId,
    );
    expect(await alias.ensureInitialized()).toBe(true);
    await alias.setStructuredFields("contact", CONTACT_FIELDS);
    const addressId = await alias.addRow(ADDRESS_FIELDS);
    expect(alias.getSnapshot().rows).toMatchObject([
      { id: addressId, fields: ADDRESS_FIELDS },
    ]);
    const before = await readDurableState(execSql, documentId);
    expect(before.document).toMatchObject({
      id: documentId,
      documentId,
      documentKind: "contact",
    });
    expect(before.history).not.toBeNull();
    expect(before.pending.length).toBeGreaterThan(0);

    // Offline with no keys: discovery is not proof that L may adopt D. Opening
    // L must wait/refuse before committing any independent birth or seed.
    const canonical = openDocumentStore(
      runtime.state.domainScope,
      localId,
      runtime,
      null,
      "",
      "contact",
      {
        initialStructuredFields: { firstName: "Second birth" },
        initialRows: [{ street: "Must not be committed" }],
      },
    );
    const canonicalReady = await canonical.ensureInitialized();

    // Neither deleting D nor rebinding a live facade may hide lost history or
    // queued edits. Compare durable bytes and reload a fresh backing store.
    expect(await readDurableState(execSql, documentId)).toEqual(before);
    const reloaded = createDocumentStore(
      documentId,
      runtime,
      persistence,
      documentId,
    );
    expect(await reloaded.ensureInitialized()).toBe(true);
    expect(reloaded.getSnapshot()).toMatchObject({
      documentId,
      documentKind: "contact",
      structuredFields: CONTACT_FIELDS,
      rows: [{ id: addressId, fields: ADDRESS_FIELDS }],
    });

    const secondBirth = await readDurableState(execSql, localId);
    // No independent birth, checkpoint, seed, or success acknowledgement may
    // appear while the existing remote identity remains unverified.
    expect(secondBirth.document).toBeNull();
    expect(secondBirth.history).toBeNull();
    expect(secondBirth.pending).toEqual([]);
    expect(canonicalReady).toBe(false);
    expect(canonical.getSnapshot().ready).toBe(false);
    expect(canonical.getSnapshot().documentId).toBeNull();
    expect(await canonical.ensureInitialized()).toBe(false);
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    await reclaimDocumentOrphanBlobs(runtime, persistence);
    close();
  }
});
