import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { resolveCurrentDocumentKekTargets } from "../../access/read/documentKekTargets";
import { readDocumentUpdateUpperBound } from "../../documents/documentUpdateStore";
import {
  lockSyncDocumentPullWatermark,
  lockSyncDocumentWriteFrontier,
} from "../../workflows/documents/mutations/syncWriteFrontier";

const databaseKind = getDefaultApiDatabaseKind();

test.skipIf(databaseKind !== "postgres")(
  "a paginated pull watermark waits for an in-flight lower update sequence",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const created = await createDocument({ owner, root });
    const { request, updateId } = await createSignedDocumentSyncRequest({
      created,
      owner,
      root,
    });
    const update = request.outgoingUpdates[0];
    if (!update) throw new Error("Expected a signed outgoing update");

    const holder = await holdPostgresLock(async (tx) => {
      const currentTargets = await resolveCurrentDocumentKekTargets(
        created.id,
        tx,
      );
      await lockSyncDocumentWriteFrontier({
        authorizingContainerIds: [],
        currentTargets,
        documentId: created.id,
        tx,
      });
      await tx.insert(documentUpdates).values({
        accessEpoch: currentTargets.linkSetEpoch,
        authorFingerprint: owner.fingerprint,
        byteLength: new TextEncoder().encode(update.encryptedData).byteLength,
        documentId: created.id,
        encryptedData: update.encryptedData,
        id: updateId,
        partialEndVersionVector: update.partialEndVersionVector,
        partialStartVersionVector: update.partialStartVersionVector,
        plaintextHash: update.plaintextHash,
      });
    });

    const reader = db.transaction(async (tx) => {
      await lockSyncDocumentPullWatermark({ documentId: created.id, tx });
      return readDocumentUpdateUpperBound(tx, created.id);
    });
    try {
      await waitForPostgresLockWait({
        blockerPid: holder.backendPid,
        queryFragment: "access_manifest_heads",
      });
    } finally {
      await holder.release();
    }
    const capturedUpperBound = await reader;
    expect(capturedUpperBound?.id).toBe(updateId);
  },
  30_000,
);

test.skipIf(databaseKind !== "postgres")(
  "concurrent paginated pull watermark readers share the document head",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const created = await createDocument({ owner, root });
    const holder = await holdPostgresLock((tx) =>
      lockSyncDocumentPullWatermark({ documentId: created.id, tx }),
    );
    let secondReaderCompleted = false;
    const secondReader = db.transaction(async (tx) => {
      await lockSyncDocumentPullWatermark({ documentId: created.id, tx });
      secondReaderCompleted = true;
    });

    try {
      await Promise.race([
        secondReader,
        Bun.sleep(2_000).then(() => {
          if (!secondReaderCompleted) {
            throw new Error("A pull watermark reader blocked another reader");
          }
        }),
      ]);
    } finally {
      await holder.release();
      await secondReader;
    }
    expect(secondReaderCompleted).toBe(true);
  },
  30_000,
);
