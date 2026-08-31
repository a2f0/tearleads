import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import {
  accessManifestHeads,
  documentUpdates,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@symcrypt/validators/response";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  buildRootGrantRequest,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const concurrencyTimeoutMs = 30_000;

function postContainerShare(input: {
  readonly containerId: string;
  readonly request: ContainerMutationRequest;
  readonly token: string;
}): Promise<Response> {
  return Promise.resolve(
    routeApp.request(`/containers/${input.containerId}/share`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.request),
    }),
  );
}

function postDocumentSync(input: {
  readonly documentId: string;
  readonly request: unknown;
  readonly token: string;
}): Promise<Response> {
  return Promise.resolve(
    routeApp.request(`/documents/${input.documentId}/sync`, {
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
  "a document write queued behind a grant fails stale",
  async () => {
    const owner = createTestUser();
    const member = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    await registerUser(member);
    await authenticate(member);
    const root = await bootstrapRoot(owner);
    const created = await createDocument({ owner, root });
    const { request: writeRequest, updateId } =
      await createSignedDocumentSyncRequest({ created, owner, root });
    const grantRequest = await buildRootGrantRequest({
      previous: root.bundle,
      previousKekState: root.kekState,
      recipient: member,
      signer: owner,
    });

    const headLock = await holdAccessManifestHeadForUpdate({
      objectId: root.kekState.containerId,
      objectKind: "container",
    });
    const contenders: Promise<Response>[] = [];
    let synchronizationError: unknown;
    try {
      contenders.push(
        postContainerShare({
          containerId: root.kekState.containerId,
          request: grantRequest,
          token: owner.token,
        }),
      );
      await waitForPostgresLockWait({
        blockerPid: headLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
      contenders.push(
        postDocumentSync({
          documentId: created.id,
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

    const [grantResponse, writeResponse] = responses;
    expect(grantResponse?.status).toBe(200);
    expect(writeResponse?.status).toBe(409);
    expect(await writeResponse?.json()).toEqual({
      code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
      error: "authorizingContainerPathRefs[0][0] is stale",
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
            eq(accessManifestHeads.objectKind, "container"),
            eq(accessManifestHeads.objectId, root.kekState.containerId),
          ),
        ),
    ]);
    expect(updates).toHaveLength(0);
    expect(heads).toEqual([
      { manifestHash: grantRequest.expectedManifestHash },
    ]);
  },
  concurrencyTimeoutMs,
);
