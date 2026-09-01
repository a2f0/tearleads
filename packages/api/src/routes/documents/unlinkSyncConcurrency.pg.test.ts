import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  isDocumentLinkSetMutationResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
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
  readonly operation: "link" | "sync" | "unlink";
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
  "a document write queued behind an unlink fails stale",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const child = await createChildContainer({ parent: root, signer: owner });
    const created = await createDocument({ owner, root });
    const linkRequest = await buildDocumentLinkRequest({
      child,
      createdDocument: created,
      owner,
      root,
    });
    const linkResponse = await postDocumentMutation({
      documentId: created.id,
      operation: "link",
      request: linkRequest,
      token: owner.token,
    });
    expect(linkResponse.status).toBe(200);
    const linked = await linkResponse.json();
    if (!isDocumentLinkSetMutationResponse(linked)) {
      throw new Error("Expected a linked document response");
    }

    const { request: writeRequest, updateId } =
      await createSignedDocumentSyncRequest({
        created: { ...linked, createdAt: created.createdAt },
        owner,
        root,
      });
    const unlinkRequest = await buildDocumentUnlinkRequest({
      child,
      linkedDocument: linked,
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
          operation: "unlink",
          request: unlinkRequest,
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

    const [unlinkResponse, writeResponse] = responses;
    expect(unlinkResponse?.status).toBe(200);
    expect(writeResponse?.status).toBe(409);
    expect(await writeResponse?.json()).toEqual({
      code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
      error: "Document manifest is stale",
    });

    const [updates, heads] = await Promise.all([
      db
        .select({ id: documentUpdates.id })
        .from(documentUpdates)
        .where(eq(documentUpdates.id, updateId)),
      db
        .select({ manifestHash: accessManifestHeads.manifestHash })
        .from(accessManifestHeads)
        .where(
          and(
            eq(accessManifestHeads.objectKind, "document"),
            eq(accessManifestHeads.objectId, created.id),
          ),
        ),
    ]);
    expect(updates).toHaveLength(0);
    expect(heads).toEqual([
      { manifestHash: unlinkRequest.expectedManifestHash },
    ]);
  },
  concurrencyTimeoutMs,
);
