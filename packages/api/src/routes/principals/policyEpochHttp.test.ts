import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { signPrincipalState } from "@tearleads/crypto";
import { joinOrg } from "../../../test/helpers/organizationMembership";
import { startPrincipalHistoryHttpProbe } from "../../../test/helpers/principalHistoryHttpProbe";
import {
  createPolicyTestGroup,
  createSignedPrincipalState,
  getDefaultOrganizationId,
  loadVerifiedPrincipalPolicy,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { signGroupSuccessor } from "../../../test/helpers/rotatedReadGroupGrant";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";

test("compound HTTP rejects signed epoch jumps atomically and still permits rotation and revocation", async () => {
  const actor = createTestUser();
  const removed = createTestUser();
  await registerAndAuthenticate(actor, removed);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  await joinOrg(organizationId, actor, removed);
  const groupId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, groupId);
  const genesis = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    members: [{ userId: actor.userId }, { userId: removed.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });
  const server = startPrincipalHistoryHttpProbe();
  const request = async (path: string, init: RequestInit) => {
    for (;;) {
      const response = await fetch(new URL(path, server.url), {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 202) return response;
      await response.arrayBuffer();
    }
  };
  const submit = (groupPolicy: typeof genesis) =>
    submitOrganizationGroupPolicyCommit({
      actor,
      groupId,
      organizationId,
      groupPolicy,
      request,
    });
  try {
    const originalDirectory = await getCurrentPrincipalState(
      "organization",
      organizationId,
      db,
    );
    const badGenesis = {
      ...genesis,
      state: await signPrincipalState(
        { ...genesis.state, keyEpoch: 2 },
        actor.signing.signingPrivateKey,
      ),
    };
    expect((await submit(badGenesis)).status).toBe(409);
    expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
    expect(
      await getCurrentPrincipalState("organization", organizationId, db),
    ).toEqual(originalDirectory);
    expect((await submit(genesis)).status).toBe(200);
    const first = await loadVerifiedPrincipalPolicy(db, "group", groupId);
    const directory = await getCurrentPrincipalState(
      "organization",
      organizationId,
      db,
    );
    const rotation = await signGroupSuccessor({
      actor,
      current: first,
      grants: [],
    });
    for (const keyEpoch of [3, 2 ** 31 - 1, Number.MAX_SAFE_INTEGER]) {
      const jump = {
        ...rotation.request,
        state: await signPrincipalState(
          { ...rotation.request.state, keyEpoch },
          actor.signing.signingPrivateKey,
        ),
      };
      const rejected = await submit(jump);
      expect(rejected.status).toBe(409);
      expect(await rejected.text()).toContain(
        "epoch must advance by exactly one",
      );
      expect(
        (await getCurrentPrincipalState("group", groupId, db))?.stateHash,
      ).toBe(first.stateHash);
      expect(
        await getCurrentPrincipalState("organization", organizationId, db),
      ).toEqual(directory);
    }
    expect((await submit(rotation.request)).status).toBe(200);
    const second = await loadVerifiedPrincipalPolicy(db, "group", groupId);
    expect(second.keyEpoch).toBe(2);
    const revocation = await signGroupSuccessor({
      actor,
      current: second,
      grants: [],
      projection: second.projection.filter(
        (member) => member.userId !== removed.userId,
      ),
    });
    expect((await submit(revocation.request)).status).toBe(200);
    const third = await loadVerifiedPrincipalPolicy(db, "group", groupId);
    expect(third.keyEpoch).toBe(3);
    expect(third.projection.map((member) => member.userId)).toEqual([
      actor.userId,
    ]);
    const response = await request(`/principals/group/${groupId}/policy`, {
      headers: { Authorization: `Bearer ${actor.token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.currentMemberEnvelopes.envelopes.map(
        (envelope: { userId: string }) => envelope.userId,
      ),
    ).toEqual([actor.userId]);
    expect(server.metrics.deadlineFailures).toBe(0);
  } finally {
    await server.stop();
  }
}, 30_000);
