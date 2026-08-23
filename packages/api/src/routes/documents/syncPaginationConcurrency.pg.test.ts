import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import { documentUpdates } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
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
