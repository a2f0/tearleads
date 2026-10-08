import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { VerifiedContainerKekState } from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import {
  isContainerMutationResponse,
  isDocumentPurgeProofResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildContainerGrantRequest } from "../../../test/helpers/containerGrantMutation";
import { buildRevokeRequest } from "../../../test/helpers/containerMutationRotations";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import { assertPurgePolicyPages } from "../../../test/helpers/documentPurgePolicyPages";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
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
import { clearAccessManifestVerificationMarkers } from "../../../test/helpers/verificationMarkers";
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
  const initialProof = await assertPurgePolicyPages(purgeResponse, owner);
  const retainedProof = await assertPurgePolicyPages(formerAdminProof, owner);
  expect(retainedProof.policyEvidence).toEqual(initialProof.policyEvidence);

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
  const revoked = await revokeResponse.json();
  if (!isContainerMutationResponse(revoked)) {
    throw new Error("Expected revoked container response");
  }
  const proofResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${replicaOwner.token}` } },
  );
  expect(proofResponse.status).toBe(200);
  const proof = await assertPurgePolicyPages(proofResponse, replicaOwner);
  if (isDocumentPurgeProofResponse(proof)) {
    expect(
      proof.documentContainerManifestHistory.some(
        (bundle) =>
          bundle.manifestHash ===
          accessManifestFromContainerResponse(revoked).manifestHash,
      ),
    ).toBe(false);
  }
});

// Real identity registration, group rotations, and cold proof verification
// exceed Bun's five-second default under concurrent CI load.
test("purge proof preserves historical signer membership after group deletion", async () => {
  const owner = createTestUser();
  const writer = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(writer);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const granted = await grantRootThroughRotatedReadGroup({
    accessLevel: "write",
    actor: owner,
    reader: writer,
    root,
  });
  const created = await createDocument({ owner: writer, root: granted.root });
  const purgeResponse = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.accessManifest.manifestHash,
    owner: writer,
    root: granted.root,
  });
  expect(purgeResponse.status).toBe(200);

  await revokeRootRotatedReadGroup({
    actor: owner,
    groupId: granted.groupId,
    removedMemberUserId: writer.userId,
    root: granted.root,
  });
  const deleteResponse = await deleteGroupRequest({
    actor: owner,
    groupId: granted.groupId,
    organizationId,
  });
  expect(deleteResponse.status).toBe(200);

  // Model a new API process: historical verification must use the retained
  // signed public snapshot, not cached full policy material erased on delete.
  await clearAccessManifestVerificationMarkers();
  const freshProjectionResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(
    freshProjectionResponse.status,
    await freshProjectionResponse.clone().text(),
  ).toBe(200);

  const proofResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${writer.token}` } },
  );
  expect(proofResponse.status).toBe(200);
  await assertPurgePolicyPages(proofResponse, writer);
}, 15_000);
