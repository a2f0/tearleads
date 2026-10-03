import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerKeyEpochs, groups } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { encryptGroupMetadata, type GroupMetadataKey } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { loadOrganizationGroupMetadataKey } from "../../../test/helpers/organizationMetadataContainer";
import {
  createPolicyTestGroup,
  createSignedPrincipalState,
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

type KeyCitation = Pick<
  GroupMetadataKey,
  "containerId" | "containerKeyEpochId"
>;

interface CitationFixture {
  readonly actor: TestUser;
  readonly metadata: KeyCitation;
  readonly otherMetadata: KeyCitation;
  readonly organizationId: string;
  readonly root: KeyCitation;
}

async function registeredOrganizationId(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);
  return getDefaultOrganizationId(user.userId);
}

async function loadCitationFixture(): Promise<CitationFixture> {
  const actor = createTestUser();
  const organizationId = await registeredOrganizationId(actor);
  const other = createTestUser();
  const otherOrganizationId = await registeredOrganizationId(other);
  const [rootEpoch] = await db
    .select({ id: containerKeyEpochs.id })
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.containerId, actor.rootContainerId))
    .limit(1);
  invariant(rootEpoch, "expected a root container key epoch");
  return {
    actor,
    metadata: await loadOrganizationGroupMetadataKey(organizationId),
    otherMetadata: await loadOrganizationGroupMetadataKey(otherOrganizationId),
    organizationId,
    root: {
      containerId: actor.rootContainerId,
      containerKeyEpochId: rootEpoch.id,
    },
  };
}

const citations: ReadonlyArray<
  readonly [string, (fixture: CitationFixture) => KeyCitation]
> = [
  ["another container's key", (fixture) => fixture.root],
  [
    "an unknown key epoch",
    (fixture) => ({
      containerId: fixture.metadata.containerId,
      containerKeyEpochId: "unknown-metadata-epoch",
    }),
  ],
  [
    "an epoch under another container id",
    (fixture) => ({
      containerId: fixture.root.containerId,
      containerKeyEpochId: fixture.metadata.containerKeyEpochId,
    }),
  ],
  ["another organization's metadata key", (fixture) => fixture.otherMetadata],
];

function citedKey(
  fixture: CitationFixture,
  citation: KeyCitation,
): GroupMetadataKey {
  return {
    ...citation,
    keyMaterial: new Uint8Array(32).fill(7),
    organizationId: fixture.organizationId,
  };
}

async function expectGroupAbsent(groupId: string): Promise<void> {
  expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
}

test.each(citations)(
  "group creation refuses a name citing %s",
  async (_label, cite) => {
    const fixture = await loadCitationFixture();
    const groupId = crypto.randomUUID();
    const request = await createGroupRequest({
      actor: fixture.actor,
      groupId,
      metadataKey: citedKey(fixture, cite(fixture)),
      name: "Operators",
    });

    const response = await routeApp.request(
      `/organizations/${fixture.organizationId}/groups`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.actor.token}`,
        },
        body: JSON.stringify(request),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Encrypted group metadata must cite the organization metadata container key",
    });
    await expectGroupAbsent(groupId);
    expect(
      await db.select().from(groups).where(eq(groups.id, groupId)),
    ).toEqual([]);
  },
);

test.each(citations)(
  "a group's first policy refuses a name citing %s",
  async (_label, cite) => {
    const fixture = await loadCitationFixture();
    const groupId = crypto.randomUUID();
    await createPolicyTestGroup(fixture.actor.userId, groupId);
    const signedState = await createSignedPrincipalState({
      members: [{ userId: fixture.actor.userId }],
      payloadCiphertext: await encryptGroupMetadata({
        groupId,
        key: citedKey(fixture, cite(fixture)),
        name: "Operators",
      }),
      principalId: groupId,
      principalType: "group",
      signerUserId: fixture.actor.userId,
      signerUserKeyFingerprint: fixture.actor.fingerprint,
      signingPrivateKey: fixture.actor.signing.signingPrivateKey,
    });

    const response = await submitOrganizationGroupPolicyCommit({
      actor: fixture.actor,
      groupId,
      groupPolicy: {
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: signedState.projection,
        grants: signedState.grants,
        memberEnvelopes: signedState.memberEnvelopes,
      },
      organizationId: fixture.organizationId,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid initial group metadata",
    });
    await expectGroupAbsent(groupId);
  },
);

// A name sealed before the metadata container rotated keeps citing that epoch,
// and members still open it through the keyring, so any epoch of the container
// is accepted, not only the current one.
test("group creation accepts a name citing a rotated-away metadata epoch", async () => {
  const fixture = await loadCitationFixture();
  const [current] = await db
    .select({ keyEpoch: containerKeyEpochs.keyEpoch })
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.id, fixture.metadata.containerKeyEpochId));
  invariant(current, "expected the current metadata epoch");
  // The citation check reads only the epoch row, so a later epoch row is
  // enough to retire the cited one.
  await db.insert(containerKeyEpochs).values({
    accessManifestHash: "rotated-metadata-manifest",
    containerId: fixture.metadata.containerId,
    createdByEventHash: "rotated-metadata-event",
    createdByManifestHash: "rotated-metadata-manifest",
    id: `rotated-metadata-epoch-${crypto.randomUUID()}`,
    keyEpoch: current.keyEpoch + 1,
  });
  const groupId = crypto.randomUUID();
  const request = await createGroupRequest({
    actor: fixture.actor,
    groupId,
    metadataKey: citedKey(fixture, fixture.metadata),
    name: "Operators",
  });

  const response = await routeApp.request(
    `/organizations/${fixture.organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fixture.actor.token}`,
      },
      body: JSON.stringify(request),
    },
  );

  expect(response.status).toBe(200);
  expect(await getCurrentPrincipalState("group", groupId, db)).not.toBeNull();
});
