import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import type { VerifiedContainerKekState } from "@symcrypt/crypto";
import type { AccessManifestBundleWire } from "@symcrypt/validators/request";
import {
  isContainerMutationResponse,
  isDocumentPurgeProofResponse,
} from "@symcrypt/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildContainerGrantRequest } from "../../../test/helpers/containerGrantMutation";
import { buildRevokeRequest } from "../../../test/helpers/containerMutationRotations";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { deleteGroupRequest } from "../../../test/helpers/organizationGroup";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  grantRootThroughRotatedReadGroup,
  revokeRootRotatedReadGroup,
} from "../../../test/helpers/rotatedReadGroupGrant";
import { routeApp } from "../../routeApp";

async function registerAndAuthenticate(user: TestUser): Promise<void> {
  await registerUser(user);
  await authenticate(user);
}

function storedChildFixture(input: {
  readonly child: {
    readonly accessManifest: unknown;
    readonly containerKek: unknown;
  };
  readonly root: StoredRootFixture;
}): StoredRootFixture {
  return {
    bundle: input.child.accessManifest as AccessManifestBundleWire,
    kekState: input.child.containerKek as VerifiedContainerKekState,
    principalPolicies: input.root.principalPolicies,
  };
}

test("purge proof remains available after its container is deleted", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const childFixture = storedChildFixture({ child, root });
  const containerPath = [root.bundle, childFixture.bundle];
  const created = await createDocument({
    containerPath,
    owner,
    root: childFixture,
  });

  const purgeResponse = await postDocumentPurge({
    authorizingContainerPath: containerPath,
    documentId: created.id,
    documentManifestHash: created.accessManifest.manifestHash,
    owner,
    root: childFixture,
  });
  expect(purgeResponse.status).toBe(200);

  const deleteResponse = await routeApp.request(
    `/containers/${child.containerId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(deleteResponse.status).toBe(200);

  const proofResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(proofResponse.status).toBe(200);
  expect(isDocumentPurgeProofResponse(await proofResponse.json())).toBe(true);
});

test("a purged document cannot be resurrected by replaying its create", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const createRequest = await createDocumentRequest({ owner, root });
  const createResponse = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createRequest),
  });
  expect(createResponse.status).toBe(200);
  const created = await createResponse.json();
  if (!("id" in created) || typeof created.id !== "string") {
    throw new Error("Expected created document response");
  }

  const purgeResponse = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: createRequest.expectedManifestHash,
    owner,
    root,
  });
  expect(purgeResponse.status).toBe(200);

  const replayResponse = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createRequest),
  });
  expect(replayResponse.status).toBe(409);
  await expect(replayResponse.json()).resolves.toEqual({
    error: "Document was permanently purged",
  });

  const writerProjectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(writerProjectionResponse.status).toBe(404);
});

test("purge proof access uses the exact historical group membership", async () => {
  const owner = createTestUser();
  const laterAdmin = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(laterAdmin);
  const root = await bootstrapRoot(owner);
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const created = await createDocument({ owner, root });
  const purgeResponse = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.accessManifest.manifestHash,
    owner,
    root,
  });
  expect(purgeResponse.status).toBe(200);

  await addUserToAdminGroup({
    actor: owner,
    member: laterAdmin,
    organizationId,
  });

  const formerAdminProof = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(formerAdminProof.status).toBe(200);
  expect(isDocumentPurgeProofResponse(await formerAdminProof.json())).toBe(
    true,
  );

  const laterAdminProof = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${laterAdmin.token}` } },
  );
  expect(laterAdminProof.status).toBe(403);
});

test("purge proof remains available to a later-revoked replica", async () => {
  const owner = createTestUser();
  const replicaOwner = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(replicaOwner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const childFixture = storedChildFixture({ child, root });
  const childPath = [root.bundle, childFixture.bundle];
  const grantRequest = await buildContainerGrantRequest({
    accessLevel: "write",
    parentKekState: root.kekState,
    previous: childFixture.bundle,
    previousContainerPath: childPath,
    previousKekState: childFixture.kekState,
    recipient: replicaOwner,
    signer: owner,
  });
  const shareResponse = await routeApp.request(
    `/containers/${child.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    },
  );
  expect(shareResponse.status).toBe(200);
  const shared = await shareResponse.json();
  if (!isContainerMutationResponse(shared)) {
    throw new Error("Expected shared container response");
  }
  const sharedChild: StoredRootFixture = {
    bundle: accessManifestFromContainerResponse(shared),
    kekState: kekStateFromContainerResponse(shared),
    principalPolicies: root.principalPolicies,
  };
  const sharedPath = [root.bundle, sharedChild.bundle];
  const created = await createDocument({
    containerPath: sharedPath,
    owner: replicaOwner,
    root: sharedChild,
  });
  const purgeResponse = await postDocumentPurge({
    authorizingContainerPath: sharedPath,
    documentId: created.id,
    documentManifestHash: created.accessManifest.manifestHash,
    owner: replicaOwner,
    root: sharedChild,
  });
  expect(purgeResponse.status).toBe(200);

  const revokeRequest = await buildRevokeRequest({
    parentKekState: root.kekState,
    previous: sharedChild.bundle,
    previousContainerPath: sharedPath,
    previousKekState: sharedChild.kekState,
    revokedUser: replicaOwner,
    signer: owner,
  });
  const revokeResponse = await routeApp.request(
    `/containers/${child.containerId}/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(revokeRequest),
    },
  );
  expect(revokeResponse.status).toBe(200);

  const proofResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${replicaOwner.token}` } },
  );
  expect(proofResponse.status).toBe(200);
  expect(isDocumentPurgeProofResponse(await proofResponse.json())).toBe(true);
});

test("purge proof survives revocation and deletion of a referenced group", async () => {
  const owner = createTestUser();
  const reader = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(reader);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const granted = await grantRootThroughRotatedReadGroup({
    actor: owner,
    reader,
    root,
  });
  const created = await createDocument({ owner, root: granted.root });
  const purgeResponse = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.accessManifest.manifestHash,
    owner,
    root: granted.root,
  });
  expect(purgeResponse.status).toBe(200);

  await revokeRootRotatedReadGroup({
    actor: owner,
    groupId: granted.groupId,
    root: granted.root,
  });
  const deleteResponse = await deleteGroupRequest({
    actor: owner,
    groupId: granted.groupId,
    organizationId,
  });
  expect(deleteResponse.status).toBe(200);

  const proofResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(proofResponse.status).toBe(200);
  expect(isDocumentPurgeProofResponse(await proofResponse.json())).toBe(true);
});
