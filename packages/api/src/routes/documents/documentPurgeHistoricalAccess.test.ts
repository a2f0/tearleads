import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import type { VerifiedContainerKekState } from "@symcrypt/crypto";
import type { AccessManifestBundleWire } from "@symcrypt/validators/request";
import {
  isContainerMutationResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentPurgeProofResponse,
} from "@symcrypt/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildContainerGrantRequest } from "../../../test/helpers/containerGrantMutation";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function registerAndAuthenticate(user: TestUser): Promise<void> {
  await registerUser(user);
  await authenticate(user);
}

function storedContainerFixture(input: {
  readonly response: {
    readonly accessManifest: unknown;
    readonly containerKek: unknown;
  };
  readonly root: StoredRootFixture;
}): StoredRootFixture {
  return {
    bundle: input.response.accessManifest as AccessManifestBundleWire,
    kekState: input.response.containerKek as VerifiedContainerKekState,
    principalPolicies: input.root.principalPolicies,
  };
}

test("a formerly linked replica cannot retrieve an unrelated later purge proof", async () => {
  const owner = createTestUser();
  const formerReplica = createTestUser();
  await registerAndAuthenticate(owner);
  await registerAndAuthenticate(formerReplica);
  const root = await bootstrapRoot(owner);
  const firstChild = await createChildContainer({
    parent: root,
    signer: owner,
  });
  const firstChildFixture = storedContainerFixture({
    response: firstChild,
    root,
  });
  const grantRequest = await buildContainerGrantRequest({
    accessLevel: "write",
    parentKekState: root.kekState,
    previous: firstChildFixture.bundle,
    previousContainerPath: [root.bundle, firstChildFixture.bundle],
    previousKekState: firstChildFixture.kekState,
    recipient: formerReplica,
    signer: owner,
  });
  const shareResponse = await routeApp.request(
    `/containers/${firstChild.containerId}/share`,
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
  const sharedFirstChild: StoredRootFixture = {
    bundle: accessManifestFromContainerResponse(shared),
    kekState: kekStateFromContainerResponse(shared),
    principalPolicies: root.principalPolicies,
  };
  const firstPath = [root.bundle, sharedFirstChild.bundle];
  const created = await createDocument({
    containerPath: firstPath,
    owner,
    root: sharedFirstChild,
  });

  const secondChild = await createChildContainer({
    parent: root,
    signer: owner,
  });
  const secondChildFixture = storedContainerFixture({
    response: secondChild,
    root,
  });
  const secondPath = [root.bundle, secondChildFixture.bundle];
  const linkResponse = await routeApp.request(`/documents/${created.id}/link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      await buildDocumentLinkRequest({
        authorizingContainerPath: firstPath,
        child: secondChild,
        createdDocument: created,
        owner,
        root,
      }),
    ),
  });
  expect(linkResponse.status, await linkResponse.clone().text()).toBe(200);
  const linked = await linkResponse.json();
  if (!isDocumentLinkSetMutationResponse(linked)) {
    throw new Error("Expected linked document response");
  }

  const unlinkResponse = await routeApp.request(
    `/documents/${created.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildDocumentUnlinkRequest({
          child: firstChild,
          linkedDocument: linked,
          owner,
          remainingContainer: secondChildFixture,
          remainingContainerPath: secondPath,
          root,
          unlinkedContainer: sharedFirstChild,
          unlinkedContainerPath: firstPath,
        }),
      ),
    },
  );
  expect(unlinkResponse.status, await unlinkResponse.clone().text()).toBe(200);
  const unlinked = await unlinkResponse.json();
  if (!isDocumentLinkSetMutationResponse(unlinked)) {
    throw new Error("Expected unlinked document response");
  }

  const purgeResponse = await postDocumentPurge({
    authorizingContainerPath: secondPath,
    documentId: created.id,
    documentManifestHash: unlinked.accessManifest.manifestHash,
    owner,
    root: secondChildFixture,
  });
  expect(purgeResponse.status, await purgeResponse.clone().text()).toBe(200);

  const proofResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${formerReplica.token}` } },
  );
  expect(proofResponse.status).toBe(403);

  const boundedForbiddenResponse = await routeApp.request(
    `/documents/${created.id}/purge?checkpointManifestHashes=${"a".repeat(64)}%2C${"b".repeat(64)}&documentCheckpointManifestHash=${"c".repeat(64)}`,
    { headers: { Authorization: `Bearer ${formerReplica.token}` } },
  );
  expect(boundedForbiddenResponse.status).toBe(403);

  const ownerProofResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(ownerProofResponse.status).toBe(200);
  const ownerProof = await ownerProofResponse.json();
  expect(isDocumentPurgeProofResponse(ownerProof)).toBe(true);
  expect(JSON.stringify(ownerProof)).toContain(
    sharedFirstChild.bundle.manifestHash,
  );
  expect(ownerProof.documentManifestContainerPaths.length).toBeGreaterThan(0);
  expect(ownerProof).not.toHaveProperty("documentManifestHistory");

  const boundedProofResponse = await routeApp.request(
    `/documents/${created.id}/purge?documentCheckpointManifestHash=${created.accessManifest.manifestHash}`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(boundedProofResponse.status).toBe(200);
  const boundedProof = await boundedProofResponse.json();
  if (!isDocumentPurgeProofResponse(boundedProof)) {
    throw new Error("Expected checkpoint-bounded document purge proof");
  }
  expect(
    boundedProof.documentManifestPredecessors.map(
      (predecessor) => predecessor.manifestHash,
    ),
  ).toEqual([
    linked.accessManifest.manifestHash,
    created.accessManifest.manifestHash,
  ]);
  for (const predecessor of boundedProof.documentManifestPredecessors) {
    expect(Reflect.get(predecessor.event.event, "eventType")).toMatch(
      /^document\.(create|link)$/,
    );
    expect(predecessor.state).toHaveProperty("documentId", created.id);
  }
});
