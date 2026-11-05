import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  containerSyncTombstones,
  containers,
  documents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { isContainerDeleteResponse } from "@tearleads/validators/response";
import { eq, inArray } from "drizzle-orm";
import {
  buildCreateRequest,
  buildMetadataDocumentCreateRequest,
} from "../../../test/helpers/containerCreateRequests";
import { userRecipientKey } from "../../../test/helpers/containerGrantMutation";
import { asVerifiedContainerManifest } from "../../../test/helpers/containerMutationRotations";
import {
  accessManifestFromResponse,
  createChild,
  deleteContainerForUser,
  expectMutationSuccess,
  kekStateFromResponse,
  listRootContainers,
  postJson,
  postMutation,
  TEST_CONTACTS_SYSTEM_SLOT,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import { readContainerParentLanePage as readLanePage } from "../../../test/helpers/containerParentLaneQuery";
import {
  buildGrantRequest,
  buildGroupGrantRequest,
} from "../../../test/helpers/containerShareRequests";
import {
  currentDocumentLinkRows,
  seedCurrentDocumentLink,
} from "../../../test/helpers/currentDocumentLinks";
import { expectDocumentAccessHistoryAbsent } from "../../../test/helpers/documentAccessHistory";
import {
  commitGroupGrant,
  firstCompoundMutation,
  putGroupPrincipalPolicy,
} from "../../../test/helpers/groupPolicyContainerCommits";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import * as grants from "../../../test/helpers/organizationGrantChanges";
import {
  addOrganizationMember,
  getDefaultOrganizationId,
} from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";

test("DELETE /containers/:id reserves the retired metadata ID", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const containerId = crypto.randomUUID();
  const containerRequest = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const metadataDocumentRequest = await buildMetadataDocumentCreateRequest({
    containerId,
    containerRequest,
    parent: root.bundle,
    signer: owner,
  });
  // A plain user folder (no systemSlot): system containers cannot be deleted.
  const created = await postJson({
    path: "/containers/with-metadata-document",
    request: {
      container: containerRequest,
      metadataDocument: metadataDocumentRequest,
    },
    token: owner.token,
  });
  expect(created.status).toBe(200);
  const metadataDocumentId = (
    containerRequest.body as { readonly metadataDocumentId: string }
  ).metadataDocumentId;

  // The folder's OWN metadata document must not block deletion of the
  // otherwise-empty folder. Regression: this returned 409 "Container has linked
  // documents" because the metadata-document link was counted as user content.
  const deleteResponse = await deleteContainerForUser({
    containerId,
    token: owner.token,
  });
  expect(deleteResponse.status).toBe(200);
  expect(isContainerDeleteResponse(await deleteResponse.json())).toBe(true);
  await grants.expectLatestChange(
    asVerifiedContainerManifest(root.bundle).state.organizationId,
  );

  await expectDocumentAccessHistoryAbsent(metadataDocumentId);
  expect(
    await db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.id, containerId)),
  ).toEqual([]);
  expect(
    await db
      .select({ documentId: containerMetadataDocuments.documentId })
      .from(containerMetadataDocuments)
      .where(eq(containerMetadataDocuments.containerId, containerId)),
  ).toEqual([{ documentId: metadataDocumentId }]);
  expect(await currentDocumentLinkRows(metadataDocumentId)).toEqual([]);
  expect(
    await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, metadataDocumentId)),
  ).toEqual([]);
});

test("DELETE /containers/:id still rejects a metadata folder holding a user document", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const containerId = crypto.randomUUID();
  const containerRequest = await buildCreateRequest({
    containerId,
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const metadataDocumentRequest = await buildMetadataDocumentCreateRequest({
    containerId,
    containerRequest,
    parent: root.bundle,
    signer: owner,
  });
  const created = await postJson({
    path: "/containers/with-metadata-document",
    request: {
      container: containerRequest,
      metadataDocument: metadataDocumentRequest,
    },
    token: owner.token,
  });
  expect(created.status).toBe(200);

  // A real user document linked into the folder must still block deletion — the
  // metadata-document exclusion must not weaken the guard for actual content.
  const userDocumentId = crypto.randomUUID();
  await db.insert(documents).values({
    id: userDocumentId,
    createdByFingerprint: owner.fingerprint,
  });
  await seedCurrentDocumentLink({ containerId, documentId: userDocumentId });

  const blocked = await deleteContainerForUser({
    containerId,
    token: owner.token,
  });
  expect(blocked.status).toBe(409);
  await expect(blocked.json()).resolves.toEqual({
    error: "Container has linked documents",
  });
});

/** A root child shared with a user directly and with a group member. */
async function arrangeLeafSharedWithUserAndGroup() {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);
  const groupMember = createTestUser();
  await registerAndAuthenticate(groupMember);

  const root = await bootstrapRoot(owner);
  const child = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childShareRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromResponse(child),
    previousContainerPath: [root.bundle, accessManifestFromResponse(child)],
    previousKekState: kekStateFromResponse(child),
    recipient,
    signer: owner,
  });
  const sharedChild = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${child.containerId}/share`,
      request: childShareRequest,
      token: owner.token,
    }),
  );

  const recipientKey = await userRecipientKey(recipient);
  const groupPrincipalId = crypto.randomUUID();
  await addOrganizationMember({
    actor: owner,
    member: groupMember,
    organizationId: await getDefaultOrganizationId(owner.userId),
  });
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    members: [{ userId: groupMember.userId }],
    principalId: groupPrincipalId,
  });
  const sharedChildBundle = accessManifestFromResponse(sharedChild);
  const grantedGroup = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [
          accessManifestFromResponse(child),
          sharedChildBundle,
        ],
        parentKekState: root.kekState,
        previous: sharedChildBundle,
        previousContainerPath: [root.bundle, sharedChildBundle],
        previousKekState: kekStateFromResponse(sharedChild),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [recipientKey],
      }),
    containerId: child.containerId,
    current: group,
  });
  const groupSharedChild = await firstCompoundMutation(grantedGroup);
  return { groupMember, groupSharedChild, owner, recipient, root };
}

test("DELETE /containers/:containerId removes a leaf and stores deleted tombstones for every reader", async () => {
  const { groupMember, groupSharedChild, owner, recipient, root } =
    await arrangeLeafSharedWithUserAndGroup();

  const deleteResponse = await deleteContainerForUser({
    containerId: groupSharedChild.containerId,
    token: owner.token,
  });
  expect(deleteResponse.status).toBe(200);
  const deleteBody = await deleteResponse.json();
  expect(isContainerDeleteResponse(deleteBody)).toBe(true);
  expect(deleteBody).toEqual({
    containerId: groupSharedChild.containerId,
    deletedAt: expect.any(String),
  });

  const liveRows = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, groupSharedChild.containerId));
  expect(liveRows).toEqual([]);

  const tombstoneRows = await db
    .select({
      containerId: containerSyncTombstones.containerId,
      parentId: containerSyncTombstones.parentId,
      reason: containerSyncTombstones.reason,
      rootDiscoveryVisible: containerSyncTombstones.rootDiscoveryVisible,
      userId: containerSyncTombstones.userId,
    })
    .from(containerSyncTombstones)
    .where(
      eq(containerSyncTombstones.containerId, groupSharedChild.containerId),
    );
  expect(tombstoneRows).toEqual(
    expect.arrayContaining([
      {
        containerId: groupSharedChild.containerId,
        parentId: root.kekState.containerId,
        reason: "deleted",
        rootDiscoveryVisible: true,
        userId: owner.userId,
      },
      {
        containerId: groupSharedChild.containerId,
        parentId: root.kekState.containerId,
        reason: "deleted",
        rootDiscoveryVisible: true,
        userId: recipient.userId,
      },
      {
        containerId: groupSharedChild.containerId,
        parentId: root.kekState.containerId,
        reason: "deleted",
        rootDiscoveryVisible: true,
        userId: groupMember.userId,
      },
    ]),
  );
});

test("DELETE /containers/:containerId emits deleted tombstones to direct and group readers", async () => {
  const { groupMember, groupSharedChild, owner, recipient, root } =
    await arrangeLeafSharedWithUserAndGroup();

  const recipientBaselineResponse = await listRootContainers({
    token: recipient.token,
  });
  expect(recipientBaselineResponse.status).toBe(200);
  const recipientBaseline = await readLanePage(recipientBaselineResponse);
  expect(
    recipientBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(groupSharedChild.containerId);

  const groupMemberBaselineResponse = await listRootContainers({
    token: groupMember.token,
  });
  expect(groupMemberBaselineResponse.status).toBe(200);
  const groupMemberBaseline = await readLanePage(groupMemberBaselineResponse);
  expect(
    groupMemberBaseline.items.map((container: { id: string }) => container.id),
  ).toContain(groupSharedChild.containerId);

  const deleteResponse = await deleteContainerForUser({
    containerId: groupSharedChild.containerId,
    token: owner.token,
  });
  expect(deleteResponse.status).toBe(200);

  const recipientDeltaResponse = await listRootContainers({
    token: recipient.token,
    watermark: recipientBaseline.nextWatermark,
  });
  expect(recipientDeltaResponse.status).toBe(200);
  const recipientDelta = await readLanePage(recipientDeltaResponse);
  expect(recipientDelta.items).toEqual([]);
  expect(recipientDelta.tombstones).toEqual([
    {
      containerId: groupSharedChild.containerId,
      depth: 1,
      parentId: root.kekState.containerId,
      reason: "deleted",
      updatedAt: expect.any(String),
    },
  ]);

  const groupMemberDeltaResponse = await listRootContainers({
    token: groupMember.token,
    watermark: groupMemberBaseline.nextWatermark,
  });
  expect(groupMemberDeltaResponse.status).toBe(200);
  const groupMemberDelta = await readLanePage(groupMemberDeltaResponse);
  expect(groupMemberDelta.items).toEqual([]);
  expect(groupMemberDelta.tombstones).toEqual([
    {
      containerId: groupSharedChild.containerId,
      depth: 1,
      parentId: root.kekState.containerId,
      reason: "deleted",
      updatedAt: expect.any(String),
    },
  ]);
});

test("DELETE /containers/:containerId rejects system roots, child-bearing containers, and non-admin users", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const parent = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const child = await createChild({
    parent: accessManifestFromResponse(parent),
    parentContainerPath: [root.bundle, accessManifestFromResponse(parent)],
    parentKekState: kekStateFromResponse(parent),
    signer: owner,
  });
  const childShareRequest = await buildGrantRequest({
    parentKekState: kekStateFromResponse(parent),
    previous: accessManifestFromResponse(child),
    previousContainerPath: [
      root.bundle,
      accessManifestFromResponse(parent),
      accessManifestFromResponse(child),
    ],
    previousKekState: kekStateFromResponse(child),
    recipient,
    signer: owner,
  });
  const sharedChild = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${child.containerId}/share`,
      request: childShareRequest,
      token: owner.token,
    }),
  );

  const rootContainerDelete = await deleteContainerForUser({
    containerId: root.kekState.containerId,
    token: owner.token,
  });
  expect(rootContainerDelete.status).toBe(400);
  await expect(rootContainerDelete.json()).resolves.toEqual({
    error: "Root container cannot be deleted",
  });

  const builtinContacts = await createChild({
    parent: root.bundle,
    parentContainerPath: [root.bundle],
    parentKekState: root.kekState,
    signer: owner,
  });
  await db
    .update(containers)
    .set({ systemSlot: TEST_CONTACTS_SYSTEM_SLOT })
    .where(eq(containers.id, builtinContacts.containerId));
  const builtinContactsDelete = await deleteContainerForUser({
    containerId: builtinContacts.containerId,
    token: owner.token,
  });
  expect(builtinContactsDelete.status).toBe(400);
  await expect(builtinContactsDelete.json()).resolves.toEqual({
    error: "System container cannot be deleted",
  });

  const parentDelete = await deleteContainerForUser({
    containerId: parent.containerId,
    token: owner.token,
  });
  expect(parentDelete.status).toBe(409);

  const linkedDocumentId = crypto.randomUUID();
  await db.insert(documents).values({
    id: linkedDocumentId,
    createdByFingerprint: owner.fingerprint,
  });
  await seedCurrentDocumentLink({
    containerId: child.containerId,
    documentId: linkedDocumentId,
  });
  const documentBearingDelete = await deleteContainerForUser({
    containerId: child.containerId,
    token: owner.token,
  });
  expect(documentBearingDelete.status).toBe(409);
  await expect(documentBearingDelete.json()).resolves.toEqual({
    error: "Container has linked documents",
  });

  const recipientDelete = await deleteContainerForUser({
    containerId: sharedChild.containerId,
    token: recipient.token,
  });
  expect(recipientDelete.status).toBe(403);

  const liveRows = await db
    .select({ id: containers.id })
    .from(containers)
    .where(inArray(containers.id, [parent.containerId, child.containerId]));
  expect(liveRows.map((row) => row.id).sort()).toEqual(
    [parent.containerId, child.containerId].sort(),
  );

  const tombstoneRows = await db
    .select({ containerId: containerSyncTombstones.containerId })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.containerId, child.containerId));
  expect(tombstoneRows).toEqual([]);
});
