import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import {
  accessManifestHeads,
  documentUpdates,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import type { ContainerMutationResponse } from "@symcrypt/validators/response";
import { DOCUMENT_SYNC_ERROR_CODES } from "@symcrypt/validators/response";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  buildRootGrantRequest,
  createDocument,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { buildRootRevokeRequest } from "../../../test/helpers/keyingWriterProjectionRevoke";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const concurrencyTimeoutMs = 30_000;

function postContainerMutation(input: {
  readonly operation: "revoke" | "share";
  readonly ownerToken: string;
  readonly request: ContainerMutationRequest;
  readonly containerId: string;
}): Promise<Response> {
  return Promise.resolve(
    routeApp.request(`/containers/${input.containerId}/${input.operation}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.request),
    }),
  );
}

function postDocumentMutation(input: {
  readonly documentId: string;
  readonly operation: "link" | "sync";
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

async function expectUpdateAbsent(updateId: string): Promise<void> {
  const rows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.id, updateId));
  expect(rows).toHaveLength(0);
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a document write queued behind revocation cannot commit stale access",
  async () => {
    const owner = createTestUser();
    const member = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    await registerUser(member);
    await authenticate(member);
    const root = await bootstrapRoot(owner);
    const shareRequest = await buildRootGrantRequest({
      previous: root.bundle,
      previousKekState: root.kekState,
      recipient: member,
      signer: owner,
    });
    const shareResponse = await postContainerMutation({
      containerId: root.kekState.containerId,
      operation: "share",
      ownerToken: owner.token,
      request: shareRequest,
    });
    expect(shareResponse.status).toBe(200);
    const sharedResponse =
      (await shareResponse.json()) as ContainerMutationResponse;
    const sharedRoot: StoredRootFixture = {
      bundle: accessManifestFromContainerResponse(sharedResponse),
      kekState: kekStateFromContainerResponse(sharedResponse),
      principalPolicies: root.principalPolicies,
    };
    const created = await createDocument({ owner, root: sharedRoot });
    const { request: writeRequest, updateId } =
      await createSignedDocumentSyncRequest({
        created,
        owner: member,
        root: sharedRoot,
      });
    const revokeRequest = await buildRootRevokeRequest({
      previous: sharedRoot.bundle,
      previousKekState: sharedRoot.kekState,
      revokedUser: member,
      signer: owner,
    });

    const headLock = await holdAccessManifestHeadForUpdate({
      objectId: sharedRoot.kekState.containerId,
      objectKind: "container",
    });
    const contenders: Promise<Response>[] = [];
    let synchronizationError: unknown;
    try {
      contenders.push(
        postContainerMutation({
          containerId: sharedRoot.kekState.containerId,
          operation: "revoke",
          ownerToken: owner.token,
          request: revokeRequest,
        }),
      );
      await waitForPostgresLockWait({ queryFragment: "access_manifest_heads" });
      contenders.push(
        postDocumentMutation({
          documentId: created.id,
          operation: "sync",
          request: writeRequest,
          token: member.token,
        }),
      );
      await waitForPostgresLockWait({
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
    const [revokeResponse, writeResponse] = responses;
    expect(revokeResponse?.status).toBe(200);
    expect(writeResponse?.status).toBe(403);
    expect(await writeResponse?.json()).toEqual({ error: "Forbidden" });
    await expectUpdateAbsent(updateId);
  },
  concurrencyTimeoutMs,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a document write queued behind a link-set change fails stale",
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
    const { request: writeRequest, updateId } =
      await createSignedDocumentSyncRequest({ created, owner, root });

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
          operation: "link",
          request: linkRequest,
          token: owner.token,
        }),
      );
      await waitForPostgresLockWait({ queryFragment: "access_manifest_heads" });
      contenders.push(
        postDocumentMutation({
          documentId: created.id,
          operation: "sync",
          request: writeRequest,
          token: owner.token,
        }),
      );
      await waitForPostgresLockWait({
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
    const [linkResponse, writeResponse] = responses;
    expect(linkResponse?.status).toBe(200);
    expect(writeResponse?.status).toBe(409);
    expect(await writeResponse?.json()).toEqual({
      code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
      error: "Document manifest is stale",
    });
    await expectUpdateAbsent(updateId);

    const [head] = await db
      .select({ manifestHash: accessManifestHeads.manifestHash })
      .from(accessManifestHeads)
      .where(
        and(
          eq(accessManifestHeads.objectKind, "document"),
          eq(accessManifestHeads.objectId, created.id),
        ),
      );
    expect(head?.manifestHash).toBe(linkRequest.expectedManifestHash);
  },
  concurrencyTimeoutMs,
);
