import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobs,
  containerSyncTombstones,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documents,
} from "@tearleads/api-shared/schema";
import { toFingerprint } from "@tearleads/crypto";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { userRecipientKey } from "../../../test/helpers/containerGrantMutation";
import {
  accessManifestFromResponse,
  createChild,
  expectMutationSuccess,
  kekStateFromResponse,
  postMutation,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import {
  buildGrantRequest,
  buildGroupGrantRequest,
} from "../../../test/helpers/containerShareRequests";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import {
  commitGroupGrant,
  firstCompoundMutation,
  putGroupPrincipalPolicy,
} from "../../../test/helpers/groupPolicyContainerCommits";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import * as grants from "../../../test/helpers/organizationGrantChanges";
import { joinOrg } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";

interface DownstreamContentKeyRowCounts {
  readonly blobContentKeyEpochs: number;
  readonly blobContentKeyTargets: number;
  readonly documentContentKeyEpochs: number;
  readonly documentContentKeyTargets: number;
}

interface SeededDownstreamContentKeyRows {
  readonly blobId: string;
  readonly documentId: string;
}

async function countDownstreamContentKeyRows(
  seeded: SeededDownstreamContentKeyRows,
): Promise<DownstreamContentKeyRowCounts> {
  const [
    blobContentKeyEpochRows,
    blobContentKeyTargetRows,
    documentContentKeyEpochRows,
    documentContentKeyTargetRows,
  ] = await Promise.all([
    db
      .select({ id: blobContentKeyEpochs.id })
      .from(blobContentKeyEpochs)
      .where(eq(blobContentKeyEpochs.blobId, seeded.blobId)),
    db
      .select({ id: blobContentKeyTargets.id })
      .from(blobContentKeyTargets)
      .innerJoin(
        blobContentKeyEpochs,
        eq(
          blobContentKeyTargets.blobContentKeyEpochId,
          blobContentKeyEpochs.id,
        ),
      )
      .where(eq(blobContentKeyEpochs.blobId, seeded.blobId)),
    db
      .select({ id: documentContentKeyEpochs.id })
      .from(documentContentKeyEpochs)
      .where(eq(documentContentKeyEpochs.documentId, seeded.documentId)),
    db
      .select({ id: documentContentKeyTargets.id })
      .from(documentContentKeyTargets)
      .innerJoin(
        documentContentKeyEpochs,
        eq(
          documentContentKeyTargets.documentContentKeyEpochId,
          documentContentKeyEpochs.id,
        ),
      )
      .where(eq(documentContentKeyEpochs.documentId, seeded.documentId)),
  ]);

  return {
    blobContentKeyEpochs: blobContentKeyEpochRows.length,
    blobContentKeyTargets: blobContentKeyTargetRows.length,
    documentContentKeyEpochs: documentContentKeyEpochRows.length,
    documentContentKeyTargets: documentContentKeyTargetRows.length,
  };
}

async function seedDownstreamContentKeyRows(input: {
  readonly containerId: string;
  readonly containerKeyEpoch: number;
  readonly containerKeyEpochId: string;
  readonly containerManifestHash: string;
  readonly owner: TestUser;
}): Promise<SeededDownstreamContentKeyRows> {
  const documentId = crypto.randomUUID();
  const documentLinkSetManifestHash = `document-link-set:${documentId}`;
  await db.insert(documents).values({
    id: documentId,
    createdByFingerprint: input.owner.fingerprint,
  });
  const [documentContentKeyEpoch] = await db
    .insert(documentContentKeyEpochs)
    .values({
      documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: documentLinkSetManifestHash,
      targetHash: `document-targets:${documentId}`,
    })
    .returning({ id: documentContentKeyEpochs.id });
  invariant(
    documentContentKeyEpoch,
    "expected seeded document content key epoch",
  );
  await db.insert(documentContentKeyTargets).values({
    documentContentKeyEpochId: documentContentKeyEpoch.id,
    containerId: input.containerId,
    containerManifestHash: input.containerManifestHash,
    containerKeyEpochId: input.containerKeyEpochId,
    containerKeyEpoch: input.containerKeyEpoch,
    ...contentKeyEnvelopeFixture(
      "Document",
      `wrapped-document-key:${documentId}`,
    ),
  });

  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  await db.insert(blobs).values({
    id: blobId,
    storageKey: `blob:${blobId}`,
    sha256: `sha256:${blobId}`,
    byteLength: 20,
  });
  await db.insert(attachmentBindings).values({
    id: bindingId,
    documentId,
    slotId: "seeded-slot",
    blobId,
    documentManifestHash: documentLinkSetManifestHash,
  });

  const [blobContentKeyEpoch] = await db
    .insert(blobContentKeyEpochs)
    .values({
      blobId,
      contentKeyEpoch: 1,
      targetHash: `blob-targets:${blobId}`,
    })
    .returning({ id: blobContentKeyEpochs.id });
  invariant(blobContentKeyEpoch, "expected seeded blob content key epoch");
  await db.insert(blobContentKeyTargets).values({
    blobContentKeyEpochId: blobContentKeyEpoch.id,
    bundleTargetHash: `blob-targets:${blobId}`,
    bindingId,
    documentId,
    containerId: input.containerId,
    containerManifestHash: input.containerManifestHash,
    containerKeyEpochId: input.containerKeyEpochId,
    containerKeyEpoch: input.containerKeyEpoch,
    ...contentKeyEnvelopeFixture("Blob", `wrapped-blob-key:${blobId}`),
  });

  return {
    blobId,
    documentId,
  };
}

test("POST /containers/:containerId/share rejects grants signed without admin access", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  await joinOrg(created.organizationId, owner, recipient);
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);
  const request = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    recipient,
    signer: intruder,
  });

  const response = await postMutation({
    path: `/containers/${created.containerId}/share`,
    request,
    token: intruder.token,
  });

  expect(response.status).toBe(403);
});

test("POST /containers/:containerId/share stores signed grants", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);
  const request = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    recipient,
    signer: owner,
  });
  const grantDelta = await grants.trackDelta(
    created.organizationId,
    owner.token,
  );
  const shared = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request,
      token: owner.token,
    }),
  );
  await grantDelta.expectReplacement(created.containerId);

  expect(shared.manifestHead.epoch).toBe(2);
  expect(shared.containerKek.containerKeyEpochId).toBe(
    created.containerKek.containerKeyEpochId,
  );
  expect(shared.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
    {
      recipientKind: "user",
      recipientId: recipient.userId,
      recipientKeyEpochId: `user:${recipient.userId}:encapsulation:${await toFingerprint(
        recipient.kem.publicKey,
      )}`,
      recipientKeyFingerprint: await toFingerprint(recipient.kem.publicKey),
    },
  ]);
});

test("POST /containers/:containerId/share avoids downstream content-key fanout for additive grants", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const createdBundle = accessManifestFromResponse(created);
  const createdKek = kekStateFromResponse(created);
  const seededContentKeyRows = await seedDownstreamContentKeyRows({
    containerId: created.containerId,
    containerKeyEpoch: createdKek.containerKeyEpoch,
    containerKeyEpochId: createdKek.containerKeyEpochId,
    containerManifestHash: createdBundle.manifestHash,
    owner,
  });
  const baselineCounts =
    await countDownstreamContentKeyRows(seededContentKeyRows);
  expect(baselineCounts).toEqual({
    blobContentKeyEpochs: 1,
    blobContentKeyTargets: 1,
    documentContentKeyEpochs: 1,
    documentContentKeyTargets: 1,
  });
  const userGrantRequest = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: createdBundle,
    previousContainerPath: [root.bundle, createdBundle],
    previousKekState: createdKek,
    recipient,
    signer: owner,
  });

  const sharedToUser = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request: userGrantRequest,
      token: owner.token,
    }),
  );

  expect(await countDownstreamContentKeyRows(seededContentKeyRows)).toEqual(
    baselineCounts,
  );
  expect(sharedToUser.containerKek.containerKeyEpochId).toBe(
    createdKek.containerKeyEpochId,
  );

  const userSharedBundle = accessManifestFromResponse(sharedToUser);
  const recipientKey = await userRecipientKey(recipient);
  const groupPrincipalId = crypto.randomUUID();
  const group = await putGroupPrincipalPolicy({
    actor: owner,
    principalId: groupPrincipalId,
  });
  const granted = await commitGroupGrant({
    actor: owner,
    buildMutation: ({ policy, reference }) =>
      buildGroupGrantRequest({
        containerManifestHistory: [createdBundle, userSharedBundle],
        parentKekState: root.kekState,
        previous: userSharedBundle,
        previousContainerPath: [root.bundle, userSharedBundle],
        previousKekState: kekStateFromResponse(sharedToUser),
        principalPolicy: policy,
        principalReference: reference,
        signer: owner,
        userRecipientKeys: [recipientKey],
      }),
    containerId: created.containerId,
    current: group,
  });
  const sharedToGroup = await firstCompoundMutation(granted);

  expect(await countDownstreamContentKeyRows(seededContentKeyRows)).toEqual(
    baselineCounts,
  );
  expect(sharedToGroup.containerKek.containerKeyEpochId).toBe(
    createdKek.containerKeyEpochId,
  );
});

test("POST /containers/:containerId/share prunes regained tombstones", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);

  // The post-revocation state: the recipient holds a stale access_revoked
  // tombstone for the child plus an undelivered one for a container they are
  // not being re-granted.
  const unrelatedContainerId = crypto.randomUUID();
  await db.insert(containerSyncTombstones).values([
    {
      containerId: created.containerId,
      depth: 1,
      organizationId: created.organizationId,
      parentId: null,
      reason: "access_revoked",
      updatedAt: new Date("2026-12-31T00:00:00.000Z"),
      userId: recipient.userId,
    },
    {
      containerId: unrelatedContainerId,
      depth: 0,
      organizationId: created.organizationId,
      parentId: null,
      reason: "access_revoked",
      updatedAt: new Date("2026-12-31T00:00:00.000Z"),
      userId: recipient.userId,
    },
  ]);

  const request = await buildGrantRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    recipient,
    signer: owner,
  });
  await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/share`,
      request,
      token: owner.token,
    }),
  );

  const remaining = await db
    .select({ containerId: containerSyncTombstones.containerId })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, recipient.userId));
  expect(remaining).toEqual([{ containerId: unrelatedContainerId }]);
});
