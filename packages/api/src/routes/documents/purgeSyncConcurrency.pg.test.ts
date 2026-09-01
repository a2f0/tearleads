import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildDocumentPurgeRequest } from "../../../test/helpers/documentPurge";
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

function postDocumentMutation(input: {
  readonly documentId: string;
  readonly operation: "purge" | "sync";
  readonly request: unknown;
  readonly token: string;
}): Promise<Response> {
  return Promise.resolve(
    routeApp.request(`/documents/${input.documentId}/${input.operation}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.request),
    }),
  );
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a document write queued behind a purge fails without orphans",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const created = await createDocument({ owner, root });
    const { request: writeRequest, updateId } =
      await createSignedDocumentSyncRequest({ created, owner, root });
    const purgeRequest = await buildDocumentPurgeRequest({
      documentId: created.id,
      documentManifestHash: created.accessManifest.manifestHash,
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
      contenders.push(
        postDocumentMutation({
          documentId: created.id,
          operation: "purge",
          request: purgeRequest,
          token: owner.token,
        }),
      );
      await waitForPostgresLockWait({
        blockerPid: headLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
      contenders.push(
        postDocumentMutation({
          documentId: created.id,
          operation: "sync",
          request: writeRequest,
          token: owner.token,
        }),
      );
      await waitForPostgresLockWait({
        blockerPid: headLock.backendPid,
        minimumWaiters: 2,
        queryFragment: "access_manifest_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await headLock.release();
    }
    const responses = await Promise.all(contenders);
    if (synchronizationError) {
      throw synchronizationError;
    }

    const [purgeResponse, writeResponse] = responses;
    expect(purgeResponse?.status).toBe(200);
    expect(writeResponse?.status).toBe(409);
    expect(await writeResponse?.json()).toEqual({
      code: DOCUMENT_SYNC_ERROR_CODES.conflict,
      error: "Document link-set manifest head missing",
    });

    const [documentRows, updateRows, headRows] = await Promise.all([
      db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, created.id)),
      db
        .select({ id: documentUpdates.id })
        .from(documentUpdates)
        .where(eq(documentUpdates.id, updateId)),
      db
        .select({ id: accessManifestHeads.id })
        .from(accessManifestHeads)
        .where(
          and(
            eq(accessManifestHeads.objectKind, "document"),
            eq(accessManifestHeads.objectId, created.id),
          ),
        ),
    ]);
    expect(documentRows).toHaveLength(0);
    expect(updateRows).toHaveLength(0);
    expect(headRows).toHaveLength(0);
  },
  concurrencyTimeoutMs,
);
