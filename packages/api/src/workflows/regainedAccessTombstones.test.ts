import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  containerSyncTombstones,
  containers,
  organizations,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  type AccessEvent,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  type KeyingCanonicalJson,
  signAccessEvent,
  type UnsignedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { authenticate } from "../../test/helpers/authenticate";
import {
  readContainerParentLanePage,
  requestContainerParentLanes,
} from "../../test/helpers/containerParentLaneQuery";
import {
  addOrganizationMember,
  getDefaultOrganizationId,
} from "../../test/helpers/organizationMembership";
import { registerUser } from "../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../access/read/principalStateStore";
import { storeVerifiedAccessManifest } from "../access/write/accessManifestStore";
import { pruneAccessGrantTombstones } from "./containers/mutations/shared/grantTombstonePruning";
import { pruneRegainedAccessTombstones } from "./regainedAccessTombstones";

const STALE_TOMBSTONE_AT = new Date("2026-12-31T00:00:00.000Z");

const SIGNED_AT = "2026-05-05T00:00:00.000Z";

async function signContainerEvent(input: {
  body: ContainerCreateAccessEventBody;
  containerId: string;
  organizationId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}): Promise<{ event: AccessEvent; eventHash: string }> {
  const unsigned: UnsignedAccessEvent = {
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: "container.create",
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: [],
    bodyHash: await computeAccessEventBodyHash(
      input.body as unknown as KeyingCanonicalJson,
    ),
    signerUserId: input.signerUserId,
    signerDeviceId: `signing-key:${input.signerKeyFingerprint}`,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signedAt: SIGNED_AT,
  };
  const event = await signAccessEvent(unsigned, input.signerPrivateKey);

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

async function storeChildContainerAccessManifest(input: {
  childContainerId: string;
  directGrants?: ContainerCreateAccessEventBody["directGrants"];
  metadataDocumentId: string;
  organizationId: string;
  owner: ReturnType<typeof createTestUser>;
  parentContainerId: string;
  parentManifestHash: string;
  referencedPrincipalHeads?: ContainerCreateAccessEventBody["referencedPrincipalHeads"];
}) {
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: input.directGrants ?? [],
    referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    containerId: input.childContainerId,
    organizationId: input.organizationId,
    signerKeyFingerprint: input.owner.fingerprint,
    signerPrivateKey: input.owner.signing.signingPrivateKey,
    signerUserId: input.owner.userId,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.childContainerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const verifiedManifest: VerifiedContainerAccessManifest = {
    event: {
      event,
      body: body as unknown as KeyingCanonicalJson,
      eventHash,
    },
    manifest,
    manifestHash,
    state,
  } as VerifiedContainerAccessManifest;

  await storeVerifiedAccessManifest({ verifiedManifest }, db);
}

async function organizationIdForContainer(
  containerId: string,
): Promise<string> {
  const rows = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  const organizationId = rows[0]?.organizationId;
  if (!organizationId) {
    throw new Error(`container ${containerId} has no organization`);
  }
  return organizationId;
}

test("prune deletes only regained access_revoked tombstones", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const organizationId = await organizationIdForContainer(
    owner.rootContainerId,
  );

  const unreachableContainerId = crypto.randomUUID();
  const deletedContainerId = crypto.randomUUID();
  await db.insert(containerSyncTombstones).values([
    {
      // Stale: the owner can read their root container, so this row is the
      // regained-access shape the prune exists for.
      containerId: owner.rootContainerId,
      depth: 0,
      organizationId,
      parentId: null,
      reason: "access_revoked",
      updatedAt: STALE_TOMBSTONE_AT,
      userId: owner.userId,
    },
    {
      // Undelivered: the owner has no access to this container, so a client
      // that never synced during the revoke window still needs the row.
      containerId: unreachableContainerId,
      depth: 0,
      organizationId,
      parentId: null,
      reason: "access_revoked",
      updatedAt: STALE_TOMBSTONE_AT,
      userId: owner.userId,
    },
    {
      // Terminal: deleted tombstones are never pruned; deletion is
      // permanent and container ids are not reused.
      containerId: deletedContainerId,
      depth: 0,
      organizationId,
      parentId: null,
      reason: "deleted",
      updatedAt: STALE_TOMBSTONE_AT,
      userId: owner.userId,
    },
  ]);

  await db.transaction(async (tx) => {
    await pruneRegainedAccessTombstones({
      executor: tx,
      userIds: [owner.userId],
    });
  });

  const remaining = await db
    .select({
      containerId: containerSyncTombstones.containerId,
      reason: containerSyncTombstones.reason,
    })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, owner.userId));
  expect(
    remaining.map((row) => `${row.reason}:${row.containerId}`).sort(),
  ).toEqual(
    [
      `access_revoked:${unreachableContainerId}`,
      `deleted:${deletedContainerId}`,
    ].sort(),
  );
});

test("pruned lane pages stop serving the stale tombstone", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const organizationId = await organizationIdForContainer(
    owner.rootContainerId,
  );

  await db.insert(containerSyncTombstones).values({
    containerId: owner.rootContainerId,
    depth: 0,
    organizationId,
    parentId: null,
    reason: "access_revoked",
    updatedAt: STALE_TOMBSTONE_AT,
    userId: owner.userId,
  });

  // Before the prune the lane serves the stale tombstone alongside the item
  // — with a newer timestamp, so a client's last-writer filter would keep
  // the restored container suppressed indefinitely.
  const beforeResponse = await requestContainerParentLanes(owner.token, [
    { laneId: "root", parentId: null },
  ]);
  expect(beforeResponse.status).toBe(200);
  const beforeBody = await readContainerParentLanePage(beforeResponse, "root");
  expect(beforeBody.tombstones).toContainEqual(
    expect.objectContaining({
      containerId: owner.rootContainerId,
      reason: "access_revoked",
    }),
  );

  await db.transaction(async (tx) => {
    await pruneRegainedAccessTombstones({
      executor: tx,
      userIds: [owner.userId],
    });
  });

  const afterResponse = await requestContainerParentLanes(owner.token, [
    { laneId: "root", parentId: null },
  ]);
  expect(afterResponse.status).toBe(200);
  const afterBody = await readContainerParentLanePage(afterResponse, "root");
  expect(afterBody.tombstones).toEqual([]);
  expect(afterBody.items).toContainEqual(
    expect.objectContaining({ id: owner.rootContainerId }),
  );
});

test("policy member re-add prunes tombstones through the route", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const member = createTestUser();
  await registerUser(member);
  const organizationId = await getDefaultOrganizationId(actor.userId);

  // A child container granted to the organization's Members GROUP: the
  // member cannot read it before the re-add, and the policy PUT is what
  // restores their access — the true group-restore shape. The candidate
  // scoping also requires this: the prune only considers containers the
  // changed principal's grants can affect.
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const memberGroupId = organization?.memberGroupId;
  if (!memberGroupId) {
    throw new Error("expected organization Members group");
  }
  const groupState = await getCurrentPrincipalState("group", memberGroupId, db);
  if (!groupState) {
    throw new Error("expected Members group state");
  }
  const rootHead = await db
    .select({ manifestHash: accessManifestHeads.manifestHash })
    .from(accessManifestHeads)
    .where(eq(accessManifestHeads.objectId, actor.rootContainerId))
    .limit(1);
  const parentManifestHash = rootHead[0]?.manifestHash;
  if (!parentManifestHash) {
    throw new Error("expected registered root manifest head");
  }
  const childContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: childContainerId,
    organizationId,
    parentId: actor.rootContainerId,
  });
  await storeChildContainerAccessManifest({
    childContainerId,
    directGrants: [
      {
        accessLevel: "read",
        subjectId: memberGroupId,
        subjectType: "group",
      },
    ],
    metadataDocumentId: crypto.randomUUID(),
    organizationId,
    owner: actor,
    parentContainerId: actor.rootContainerId,
    parentManifestHash,
    referencedPrincipalHeads: [
      {
        keyEpoch: groupState.keyEpoch,
        keyFingerprint: groupState.keyFingerprint,
        principalId: memberGroupId,
        principalType: "group",
        stateHash: groupState.stateHash,
        version: groupState.version,
      },
    ],
  });

  await db.insert(containerSyncTombstones).values({
    containerId: childContainerId,
    depth: 1,
    organizationId,
    parentId: actor.rootContainerId,
    reason: "access_revoked",
    updatedAt: STALE_TOMBSTONE_AT,
    userId: member.userId,
  });

  await addOrganizationMember({ actor, member, organizationId });

  const remaining = await db
    .select({ id: containerSyncTombstones.id })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, member.userId));
  expect(remaining).toEqual([]);
});

test("container.grant pruning runs for added user grants only", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const organizationId = await organizationIdForContainer(
    owner.rootContainerId,
  );

  await db.insert(containerSyncTombstones).values({
    containerId: owner.rootContainerId,
    depth: 0,
    organizationId,
    parentId: null,
    reason: "access_revoked",
    updatedAt: STALE_TOMBSTONE_AT,
    userId: owner.userId,
  });

  const grantManifest = (grants: unknown[]) =>
    ({
      event: { event: { eventType: "container.grant" } },
      state: { directGrants: grants },
    }) as never;

  // A non-grant event never prunes.
  await db.transaction(async (tx) => {
    await pruneAccessGrantTombstones({
      executor: tx,
      manifest: {
        event: { event: { eventType: "container.revoke" } },
        state: { directGrants: [] },
      } as never,
      previousManifest: grantManifest([]),
    });
  });
  let remaining = await db
    .select({ id: containerSyncTombstones.id })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, owner.userId));
  expect(remaining).toHaveLength(1);

  // A grant that adds the user prunes their regained tombstone.
  await db.transaction(async (tx) => {
    await pruneAccessGrantTombstones({
      executor: tx,
      manifest: grantManifest([
        { accessLevel: "read", subjectId: owner.userId, subjectType: "user" },
      ]),
      previousManifest: grantManifest([]),
    });
  });
  remaining = await db
    .select({ id: containerSyncTombstones.id })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, owner.userId));
  expect(remaining).toEqual([]);
});
