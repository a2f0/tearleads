import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import {
  documentAuditEntries,
  documentUpdateAuditEvents,
  documentUpdates,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { isDocumentSyncResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const concurrencyTimeoutMs = 30_000;

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a retry racing a lost sync acknowledgment commits idempotently",
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

    const headLock = await holdAccessManifestHeadForUpdate({
      objectId: created.id,
      objectKind: "document",
    });
    const contenders: Promise<Response>[] = [];
    let synchronizationError: unknown;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        contenders.push(
          Promise.resolve(
            routeApp.request(`/documents/${created.id}/sync`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${owner.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(request),
            }),
          ),
        );
        await waitForPostgresLockWait({
          blockerPid: headLock.backendPid,
          minimumWaiters: attempt + 1,
          queryFragment: "access_manifest_heads",
        });
      }
    } catch (error) {
      synchronizationError = error;
    } finally {
      await headLock.release();
    }

    const responses = await Promise.all(contenders);
    if (synchronizationError) {
      throw synchronizationError;
    }
    expect(responses).toHaveLength(2);
    for (const response of responses) {
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(isDocumentSyncResponse(body)).toBe(true);
      if (!isDocumentSyncResponse(body)) {
        throw new Error("Expected a document sync response");
      }
      expect(body.acceptedOutgoingUpdateIds).toEqual([updateId]);
    }

    const [storedUpdates, auditEntries, auditEvents] = await Promise.all([
      db
        .select({ id: documentUpdates.id })
        .from(documentUpdates)
        .where(eq(documentUpdates.id, updateId)),
      db
        .select({ id: documentAuditEntries.id })
        .from(documentAuditEntries)
        .where(eq(documentAuditEntries.documentId, created.id)),
      db
        .select({ liveUpdateId: documentUpdateAuditEvents.liveUpdateId })
        .from(documentUpdateAuditEvents)
        .where(eq(documentUpdateAuditEvents.liveUpdateId, updateId)),
    ]);
    expect(storedUpdates).toEqual([{ id: updateId }]);
    expect(auditEntries).toHaveLength(1);
    expect(auditEvents).toEqual([{ liveUpdateId: updateId }]);
  },
  concurrencyTimeoutMs,
);
