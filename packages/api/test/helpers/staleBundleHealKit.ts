import { expect } from "bun:test";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import { computeDocumentContentKeyTargetHash } from "@symcrypt/crypto";
import type { DocumentCreateResponse } from "@symcrypt/validators/response";
import { isContainerMutationResponse } from "@symcrypt/validators/response";
import { routeApp } from "../../src/routeApp";
import { authenticate } from "./authenticate";
import {
  accessManifestFromContainerResponse,
  buildRootGrantRequest,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "./keyingWriterProjectionKit";
import { buildRootRevokeRequest } from "./keyingWriterProjectionRevoke";
import { registerUser } from "./registerUser";

/**
 * Shares the root with a throwaway recipient and immediately revokes them,
 * rotating the root container key epoch under every pre-existing document's
 * stored content-key bundle — the state the stale-bundle protocol handles.
 */
export async function shareAndRevokeRoot(input: {
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}) {
  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

  const shareRequest = await buildRootGrantRequest({
    previous: input.root.bundle,
    previousKekState: input.root.kekState,
    recipient,
    signer: input.owner,
  });
  const shareResponse = await routeApp.request(
    `/containers/${input.root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(shareRequest),
    },
  );
  expect(shareResponse.status).toBe(200);
  const shared = await shareResponse.json();
  expect(isContainerMutationResponse(shared)).toBe(true);

  const revokeRequest = await buildRootRevokeRequest({
    previous: accessManifestFromContainerResponse(shared),
    previousKekState: kekStateFromContainerResponse(shared),
    revokedUser: recipient,
    signer: input.owner,
  });
  const revokeResponse = await routeApp.request(
    `/containers/${input.root.kekState.containerId}/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(revokeRequest),
    },
  );
  expect(revokeResponse.status).toBe(200);
  const revoked = await revokeResponse.json();
  expect(isContainerMutationResponse(revoked)).toBe(true);
  // The revoke rotated the container key epoch; the document's stored bundle
  // still points at the pre-revoke epoch.
  expect(revoked.containerKek.containerKeyEpochId).not.toBe(
    input.root.kekState.containerKeyEpochId,
  );

  return {
    revokedKek: kekStateFromContainerResponse(revoked),
    revokedManifest: accessManifestFromContainerResponse(revoked),
  };
}

export async function getWriterProjection(
  owner: TestUser,
  documentId: string,
): Promise<{ response: Response; projection: unknown }> {
  const response = await routeApp.request(
    `/documents/${documentId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  return { response, projection: await response.json() };
}

export async function postDocumentSync(
  owner: TestUser,
  documentId: string,
  request: unknown,
): Promise<Response> {
  return routeApp.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

/**
 * The bundle a healing writer submits: the (opaque, re-wrapped) content key
 * bound to the post-revoke targets at the next content-key epoch.
 */
export async function buildHealedContentKeyBundle(input: {
  readonly created: DocumentCreateResponse;
  readonly revokedKek: ReturnType<typeof kekStateFromContainerResponse>;
  readonly revokedManifestHash: string;
}): Promise<DocumentCreateResponse["contentKeyBundle"]> {
  const targets = [
    {
      containerId: input.revokedKek.containerId,
      containerManifestHash: input.revokedManifestHash,
      containerKeyEpochId: input.revokedKek.containerKeyEpochId,
      containerKeyEpoch: input.revokedKek.containerKeyEpoch,
    },
  ];

  return {
    contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch + 1,
    documentId: input.created.id,
    linkSetManifestHash: input.created.contentKeyBundle.linkSetManifestHash,
    targetHash: await computeDocumentContentKeyTargetHash(targets),
    targets: targets.map((target) => ({
      ...target,
      wrappedKey: `document-key:${input.created.id}:rewrapped`,
      wrappingMetadata: { alg: "test-wrap" },
    })),
  };
}
