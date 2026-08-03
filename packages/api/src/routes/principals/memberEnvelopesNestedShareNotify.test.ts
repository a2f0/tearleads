import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  type PrincipalProjectionMember,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { createRouteApp, routeApp } from "../../routeApp";

async function createOrganizationGroup(input: {
  actor: ReturnType<typeof createTestUser>;
  groupId: string;
  name: string;
  nestedGroupIds?: readonly string[];
  organizationId: string;
}): Promise<void> {
  const response = await routeApp.request(
    `/organizations/${input.organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor: input.actor,
          groupId: input.groupId,
          name: input.name,
          nestedGroupIds: input.nestedGroupIds,
        }),
      ),
    },
  );
  expect(response.status).toBe(200);
}

async function signChildAccessGain(input: {
  actor: ReturnType<typeof createTestUser>;
  childGroupId: string;
  member: ReturnType<typeof createTestUser>;
}) {
  const currentState = await getCurrentPrincipalState(
    "group",
    input.childGroupId,
    db,
  );
  invariant(currentState, "expected current child-group policy");
  const currentProjection = await listCurrentPrincipalProjectionMembers(
    "group",
    input.childGroupId,
    db,
  );
  const projection: PrincipalProjectionMember[] = [
    ...currentProjection.map((projectionMember) => ({
      userId: projectionMember.userId,
      role: projectionMember.role,
    })),
    {
      userId: input.member.userId,
      role: "member",
    },
  ];
  const groupKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: groupKem.secretKey,
      projection,
    });

  return signPrincipalStateBundle({
    principalType: "group",
    principalId: input.childGroupId,
    version: currentState.version + 1,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
    keyFingerprint: await toFingerprint(groupKem.publicKey),
    members: stateMembers,
    projection,
    externalAuthority: currentState.externalAuthority,
    payloadCiphertext: JSON.stringify({ members: projection }),
    signedAt: "2026-07-17T12:00:00.000Z",
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
    memberEnvelopes,
  });
}

function sharedWithYouUserIds(
  events: ReadonlyArray<Record<string, unknown>>,
): string[] {
  return events
    .filter((event) => Reflect.get(event, "type") === "shared_with_you")
    .map((event) => Reflect.get(event, "userId"))
    .filter((userId): userId is string => typeof userId === "string");
}

test("PUT child policy notifies a user gaining access through a granted ancestor", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const member = createTestUser();
  await registerUser(member);

  const [actorRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1);
  invariant(actorRow, "expected registered actor");

  const childGroupId = crypto.randomUUID();
  await createOrganizationGroup({
    actor,
    groupId: childGroupId,
    name: "Child",
    organizationId: actorRow.organizationId,
  });
  const parentGroupId = crypto.randomUUID();
  await createOrganizationGroup({
    actor,
    groupId: parentGroupId,
    name: "Parent",
    nestedGroupIds: [childGroupId],
    organizationId: actorRow.organizationId,
  });

  const [rootHead] = await db
    .select({ manifestHash: accessManifestHeads.manifestHash })
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(accessManifestHeads.objectId, actor.rootContainerId),
      ),
    )
    .limit(1);
  invariant(rootHead, "expected provisioned root-container head");
  await db.insert(accessManifestContainerGrantProjection).values({
    accessLevel: "admin",
    containerId: actor.rootContainerId,
    manifestHash: rootHead.manifestHash,
    subjectId: parentGroupId,
    subjectType: "group",
  });

  const signedState = await signChildAccessGain({
    actor,
    childGroupId,
    member,
  });
  const publishedEvents: Array<Record<string, unknown>> = [];
  const app = createRouteApp({
    publish: async (event) => {
      publishedEvents.push(event);
    },
  });
  const response = await app.request(
    `/principals/group/${childGroupId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: signedState.state,
        encryptedPayload: signedState.encryptedPayload,
        projection: signedState.projection,
        memberEnvelopes: signedState.memberEnvelopes,
      }),
    },
  );

  expect(response.status).toBe(200);
  expect(sharedWithYouUserIds(publishedEvents)).toEqual([member.userId]);
});
