import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  documentUpdates,
  organizationReadModelHeads,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  isContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  bootstrapRoot,
  buildRootGrantRequest,
  createDocument,
  kekStateFromContainerResponse,
  loadPrincipalPoliciesForContainerPath,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { buildRootRevokeRequest } from "../../../test/helpers/keyingWriterProjectionRevoke";
import {
  holdAccessManifestHeadForUpdate,
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { runStartOrganizationTrialWorkflow } from "../../workflows/billing/organizationBilling";

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

async function loadRootFixture(input: {
  readonly ownerToken: string;
  readonly rootContainerId: string;
}): Promise<StoredRootFixture> {
  const response = await routeApp.request(
    `/containers/${input.rootContainerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${input.ownerToken}` } },
  );
  const value = await response.json();
  if (!response.ok || !isContainerWriterProjectionResponse(value)) {
    throw new Error("Expected a root container writer projection");
  }
  const bundle = value.path[0];
  const kekState = value.containerKeks[0];
  if (!bundle || !kekState || value.path.length !== 1) {
    throw new Error("Expected a one-segment root projection");
  }
  return {
    bundle,
    kekState: kekState as unknown as StoredRootFixture["kekState"],
    principalPolicies: await loadPrincipalPoliciesForContainerPath([bundle]),
  };
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
      await waitForPostgresLockWait({
        blockerPid: headLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
      contenders.push(
        postDocumentMutation({
          documentId: created.id,
          operation: "sync",
          request: writeRequest,
          token: member.token,
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
    const [revokeResponse, writeResponse] = responses;
    expect(revokeResponse?.status).toBe(200);
    expect(writeResponse?.status).toBe(403);
    expect(await writeResponse?.json()).toEqual({ error: "Forbidden" });
    await expectUpdateAbsent(updateId);
  },
  concurrencyTimeoutMs,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "opposing cross-organization rekey plus link plans cannot deadlock",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const firstRoot = await bootstrapRoot(owner);
    const secondOrganization = await createOrganizationRequestBody(owner);
    const createResponse = await submitCreateOrganization(
      owner,
      secondOrganization,
    );
    expect(createResponse.status).toBe(200);
    await runStartOrganizationTrialWorkflow(
      db,
      secondOrganization.organizationId,
      owner.userId,
    );
    const secondRoot = await loadRootFixture({
      ownerToken: owner.token,
      rootContainerId: secondOrganization.rootContainerId,
    });
    const [firstChild, secondChild] = await Promise.all([
      createChildContainer({ parent: firstRoot, signer: owner }),
      createChildContainer({ parent: secondRoot, signer: owner }),
    ]);
    const [firstDocument, secondDocument] = await Promise.all([
      createDocument({ owner, root: firstRoot }),
      createDocument({ owner, root: secondRoot }),
    ]);
    const [firstLink, secondLink, firstRekey, secondRekey] = await Promise.all([
      buildDocumentLinkRequest({
        child: firstChild,
        createdDocument: firstDocument,
        owner,
        root: firstRoot,
      }),
      buildDocumentLinkRequest({
        child: secondChild,
        createdDocument: secondDocument,
        owner,
        root: secondRoot,
      }),
      buildRootContainerRekeyMutation({ previous: firstRoot, signer: owner }),
      buildRootContainerRekeyMutation({ previous: secondRoot, signer: owner }),
    ]);
    firstLink.containerRekeys = [secondRekey.request];
    secondLink.containerRekeys = [firstRekey.request];

    const firstOrganizationId = asVerifiedContainerManifest(firstRoot.bundle)
      .state.organizationId;
    const lockedOrganizationId = [
      firstOrganizationId,
      secondOrganization.organizationId,
    ].sort()[0];
    if (!lockedOrganizationId) {
      throw new Error("Expected an organization lock target");
    }
    const organizationLock = await holdPostgresLock(async (tx) => {
      await tx
        .select({ organizationId: organizationReadModelHeads.organizationId })
        .from(organizationReadModelHeads)
        .where(
          eq(organizationReadModelHeads.organizationId, lockedOrganizationId),
        )
        .for("update");
    });
    const contenders: Promise<Response>[] = [];
    let synchronizationError: unknown;
    try {
      contenders.push(
        postDocumentMutation({
          documentId: firstDocument.id,
          operation: "link",
          request: firstLink,
          token: owner.token,
        }),
      );
      await waitForPostgresLockWait({
        blockerPid: organizationLock.backendPid,
        queryFragment: "organization_read_model_heads",
      });
      contenders.push(
        postDocumentMutation({
          documentId: secondDocument.id,
          operation: "link",
          request: secondLink,
          token: owner.token,
        }),
      );
      await waitForPostgresLockWait({
        blockerPid: organizationLock.backendPid,
        minimumWaiters: 2,
        queryFragment: "organization_read_model_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await organizationLock.release();
    }
    const responses = await Promise.all(contenders);
    if (synchronizationError) {
      throw synchronizationError;
    }
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
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
