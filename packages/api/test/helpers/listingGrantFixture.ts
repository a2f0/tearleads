import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifests,
  containers,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";

// Raw rows for the container listing query alone: containers with one head
// each, the grant projection keyed by manifest hash, and group memberships
// bound to a principal state. Nothing here is signed; the listing reads only
// these tables, so its results can be checked against a model of the rows.

export interface ListingGrantSubject {
  readonly subjectId: string;
  readonly subjectType: "group" | "user";
}

export interface ListingFixtureContainer {
  readonly depth: number;
  readonly epoch: number;
  readonly grants: readonly ListingGrantSubject[];
  readonly id: string;
  readonly manifestHash: string;
  readonly metadataDocumentId: string;
  readonly organizationId: string;
  readonly parentId: string | null;
  readonly updatedAt: Date;
}

export async function seedListingGroup(input: {
  readonly currentMember: string | null;
  readonly staleMember: string | null;
}): Promise<string> {
  const principalId = crypto.randomUUID();
  const stateHashes = [1, 2].map(
    (version) => `${principalId}-state-${version}`,
  );
  await db.insert(principalStates).values(
    stateHashes.map((stateHash, index) => ({
      containerGrants: [],
      encapsulationPublicKey: "listing-fixture",
      grantCount: 0,
      grantRoot: "listing-fixture",
      keyEpoch: 1,
      keyFingerprint: "listing-fixture",
      memberCount: 1,
      memberEnvelopesRoot: "listing-fixture",
      membershipMode: "projection" as const,
      membershipRoot: "listing-fixture",
      payloadCiphertextHash: "listing-fixture",
      prevStateHash: index === 0 ? null : (stateHashes[0] ?? null),
      principalId,
      principalType: "group" as const,
      projectionRoot: "listing-fixture",
      signature: "listing-fixture",
      signedAt: new Date("2026-10-01T00:00:00.000Z"),
      signerUserId: crypto.randomUUID(),
      signerUserKeyFingerprint: "listing-fixture",
      stateHash,
      version: index + 1,
    })),
  );
  // Membership counts only at the group's current (latest) state.
  const members = [
    { stateHash: stateHashes[1], userId: input.currentMember },
    { stateHash: stateHashes[0], userId: input.staleMember },
  ];
  for (const { stateHash, userId } of members) {
    if (userId === null || stateHash === undefined) continue;
    await db.insert(principalMembershipProjection).values({
      principalId,
      principalType: "group",
      role: "member",
      stateHash,
      userId,
    });
  }
  return principalId;
}

export async function seedListingContainer(input: {
  readonly epoch?: number;
  readonly grants?: readonly ListingGrantSubject[];
  readonly organizationId: string;
  readonly parent: ListingFixtureContainer | null;
  // Grants on the container's previous manifest, which no longer count.
  readonly staleGrants?: readonly ListingGrantSubject[];
  readonly updatedAt: Date;
}): Promise<ListingFixtureContainer> {
  const id = crypto.randomUUID();
  const epoch = input.epoch ?? 1;
  const manifestHash = `${id}-manifest-${epoch}`;
  const metadataDocumentId = crypto.randomUUID();
  const depth = input.parent === null ? 0 : input.parent.depth + 1;
  const grants = input.grants ?? [];
  await db.insert(containers).values({
    depth,
    id,
    organizationId: input.organizationId,
    parentId: input.parent?.id ?? null,
    updatedAt: input.updatedAt,
  });
  await db.insert(accessManifests).values({
    epoch,
    eventHash: `${manifestHash}-event`,
    grantRoot: "listing-fixture",
    keyTargetHash: "listing-fixture",
    manifestHash,
    objectId: id,
    objectKind: "container",
    organizationId: input.organizationId,
    referencedPrincipalHeads: [],
    state: { metadataDocumentId },
    structuralHash: "listing-fixture",
    version: 1,
  });
  await db.insert(accessManifestHeads).values({
    epoch,
    manifestHash,
    objectId: id,
    objectKind: "container",
    organizationId: input.organizationId,
  });
  const grantRows = [
    ...grants.map((grant) => ({ grant, hash: manifestHash })),
    ...(input.staleGrants ?? []).map((grant) => ({
      grant,
      hash: `${id}-manifest-${epoch - 1}`,
    })),
  ];
  if (grantRows.length > 0) {
    await db.insert(accessManifestContainerGrantProjection).values(
      grantRows.map(({ grant, hash }, index) => ({
        // Distinct levels keep repeated subjects unique, as a manifest that
        // grants one subject twice would.
        accessLevel: `level-${index}`,
        containerId: id,
        manifestHash: hash,
        subjectId: grant.subjectId,
        subjectType: grant.subjectType,
      })),
    );
  }
  return {
    depth,
    epoch,
    grants,
    id,
    manifestHash,
    metadataDocumentId,
    organizationId: input.organizationId,
    parentId: input.parent?.id ?? null,
    updatedAt: input.updatedAt,
  };
}
