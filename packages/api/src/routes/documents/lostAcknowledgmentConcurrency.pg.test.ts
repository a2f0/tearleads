import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentSyncResponse } from "@tearleads/validators/response";
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

    const [storedUpdates, writeHeaders] = await Promise.all([
      db
        .select({ id: documentUpdates.id })
        .from(documentUpdates)
        .where(eq(documentUpdates.documentId, created.id)),
      db
        .select({ updateId: documentContentWriteHeaders.updateId })
        .from(documentContentWriteHeaders)
        .where(eq(documentContentWriteHeaders.documentId, created.id)),
    ]);
    expect(storedUpdates).toEqual([{ id: updateId }]);
    expect(writeHeaders).toEqual([{ updateId }]);
  },
  concurrencyTimeoutMs,
);
