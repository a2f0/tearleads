import { db } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import { computePrincipalStateHash } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import type {
  CommitOrganizationGroupPolicyRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { getCurrentPrincipalState } from "../../src/access/read/principalStateStore";
import { parseOrganizationAuthorityDescriptor } from "../../src/workflows/organizations/organizationAuthorityDescriptor";
import { createGroupRequest } from "./organizationGroup";
import { withGroupMembershipContainerMutations } from "./organizationMembershipGrants";
import {
  buildOrganizationGroupPolicyCommitRequest,
  getDefaultOrganizationId,
  loadVerifiedPrincipalPolicy,
} from "./principalPolicy";
import { registerAndAuthenticate } from "./principalPolicyReadFixtures";
import { requestAfterPrincipalPreparation } from "./principalPreparationRequest";
import { signPrincipalStateBundle } from "./principalState";
import { signGroupSuccessor } from "./rotatedReadGroupGrant";

export async function createAtomicEnrollmentFixture(groupAfterMembers = false) {
  const actor = createTestUser();
  const member = createTestUser();
  await registerAndAuthenticate(actor, member);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization");
  let groupId = crypto.randomUUID();
  while (groupAfterMembers && groupId <= organization.memberGroupId) {
    groupId = crypto.randomUUID();
  }
  const created = await requestAfterPrincipalPreparation(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({ actor, groupId, name: "Atomic enrollment" }),
      ),
    },
  );
  invariant(created.ok, await created.text());
  const prepare = async (groupId: string, role: "admin" | "member") => {
    const current = await loadVerifiedPrincipalPolicy(db, "group", groupId);
    const successor = await signGroupSuccessor({
      actor,
      current,
      grants: current.grants,
      projection: [...current.projection, { userId: member.userId, role }],
    });
    return withGroupMembershipContainerMutations({
      actor,
      currentPolicy: current,
      signedState: successor.request,
    });
  };
  const memberPolicy = await prepare(organization.memberGroupId, "member");
  const groupPolicy = await prepare(groupId, "member");
  const base = await buildOrganizationGroupPolicyCommitRequest({
    actor,
    organizationId,
    groupPolicy,
  });
  const organizationPolicy = await includeMemberHead(
    actor,
    base.organizationPolicy,
    memberPolicy,
  );
  const request = { ...base, organizationPolicy, memberPolicy };
  const readHeads = async () =>
    Promise.all([
      getCurrentPrincipalState("group", organization.memberGroupId, db),
      getCurrentPrincipalState("group", groupId, db),
      getCurrentPrincipalState("organization", organizationId, db),
    ]);
  const before = await readHeads();
  const commit = (
    body: CommitOrganizationGroupPolicyRequest = request,
    targetGroupId: string = groupId,
    transport?: Parameters<typeof requestAfterPrincipalPreparation>[2],
  ) =>
    requestAfterPrincipalPreparation(
      `/organizations/${organizationId}/groups/${targetGroupId}/policy-commit`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${actor.token}`,
        },
        body: JSON.stringify(body),
      },
      transport,
    );
  return {
    actor,
    member,
    organization,
    organizationId,
    request,
    staleDirectory: base.organizationPolicy,
    readHeads,
    before,
    commit,
  };
}

async function includeMemberHead(
  actor: ReturnType<typeof createTestUser>,
  directory: PutPrincipalPolicyRequest,
  memberPolicy: PutPrincipalPolicyRequest,
): Promise<PutPrincipalPolicyRequest> {
  const descriptor = parseOrganizationAuthorityDescriptor(
    directory.encryptedPayload.ciphertext,
  );
  invariant(descriptor, "expected signed directory");
  const memberHead = {
    principalType: "group" as const,
    principalId: memberPolicy.state.principalId,
    version: memberPolicy.state.version,
    keyEpoch: memberPolicy.state.keyEpoch,
    keyFingerprint: memberPolicy.state.keyFingerprint,
    stateHash: await computePrincipalStateHash(memberPolicy.state),
  };
  return signPrincipalStateBundle({
    ...directory.state,
    members: directory.projection.map(({ userId }) => ({ userId })),
    projection: directory.projection,
    memberEnvelopes: directory.memberEnvelopes,
    grants: directory.grants,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(
        JSON.stringify({
          ...descriptor,
          groupHeads: descriptor.groupHeads.map((head) =>
            head.principalId === memberHead.principalId ? memberHead : head,
          ),
        }),
      ),
    ),
    signingPrivateKey: actor.signing.signingPrivateKey,
  });
}
