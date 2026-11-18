import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import type {
  CommitOrganizationGroupPolicyRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import invariant from "invariant";
import {
  byReference,
  commit,
  groupWithSameEpochAdd,
  resend,
} from "../../../test/helpers/memberEnvelopeReferenceFixture";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import {
  buildOrganizationGroupPolicyCommitRequest,
  runGetCurrentPrincipalPolicyWorkflow,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";

test("a same-epoch group leg sent as changes stores the signed full set", async () => {
  const f = await groupWithSameEpochAdd();
  const full = await f.sign(f.current.keyEpoch, [...f.retained, f.added]);
  const { body, response } = await commit(f, byReference(full, [f.added]));
  expect(response.status).toBe(200);
  const original = await response.json();
  const stored = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "group",
    f.groupId,
  );
  expect(stored.currentState).toMatchObject({
    keyEpoch: f.current.keyEpoch,
    memberEnvelopesRoot: full.state.memberEnvelopesRoot,
    version: f.current.version + 1,
  });
  expect(
    stored.currentMemberEnvelopes.envelopes.map((envelope) => envelope.userId),
  ).toEqual([...f.retained, f.added].map((envelope) => envelope.userId).sort());

  // A retry in the other form, in any envelope order, is the same request:
  // it replays the commit.
  invariant(body, "expected the sent request");
  const sent: CommitOrganizationGroupPolicyRequest = body;
  for (const memberEnvelopes of [
    full.memberEnvelopes,
    [...full.memberEnvelopes].reverse(),
  ]) {
    const retried = await resend(f, {
      ...sent,
      groupPolicy: { ...full, memberEnvelopes },
    });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(original);
  }
});

test("an admin's changes must name the route principal before any lookup", async () => {
  const f = await groupWithSameEpochAdd();
  const full = await f.sign(f.current.keyEpoch, [...f.retained, f.added]);
  const answers = [];
  for (const prevStateHash of [full.state.prevStateHash, "0".repeat(64)]) {
    const leg = byReference(
      { ...full, state: { ...full.state, prevStateHash } },
      [f.added],
    );
    // The custom group's leg posing as the Members leg.
    const body = await buildOrganizationGroupPolicyCommitRequest({
      actor: f.owner,
      groupPolicy: full,
      organizationId: f.organizationId,
    });
    const response = await resend(f, { ...body, memberPolicy: leg });
    answers.push({ body: await response.text(), status: response.status });
  }
  expect(answers[0]).toEqual({
    body: JSON.stringify({
      error: "Member envelope changes must name the route's principal",
    }),
    status: 400,
  });
  expect(answers[1]).toEqual(answers[0]);
});

test("a rebuild reveals nothing before the route and admin are checked", async () => {
  const f = await groupWithSameEpochAdd();
  const outsider = createTestUser();
  await registerAndAuthenticateUsers(outsider);
  // Signed by the outsider, so it passes the signer binding before the
  // transaction and reaches the rebuild.
  const full = await f.sign(
    f.current.keyEpoch,
    [...f.retained, f.added],
    outsider,
  );
  const cited = byReference(full, [f.added]);
  const unknown = {
    ...cited,
    state: { ...cited.state, prevStateHash: "0".repeat(64) },
  };
  const answers = [];
  for (const groupPolicy of [cited, unknown]) {
    const response = await routeApp.request(
      `/organizations/${f.organizationId}/groups/${f.groupId}/policy-commit`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${outsider.token}`,
        },
        body: JSON.stringify(
          await buildOrganizationGroupPolicyCommitRequest({
            actor: outsider,
            groupPolicy,
            organizationId: f.organizationId,
          }),
        ),
      },
    );
    answers.push({ body: await response.text(), status: response.status });
  }
  expect(answers[0]?.status).toBe(403);
  expect(answers[1]).toEqual(answers[0]);
});

test("group create and delete refuse bad changes with a typed error", async () => {
  const f = await groupWithSameEpochAdd();
  const directory = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "organization",
    f.organizationId,
  );
  const stale = (
    leg: PutPrincipalPolicyRequest,
  ): PutPrincipalPolicyRequest => ({
    ...leg,
    memberEnvelopeChanges: { removeUserIds: [], upsert: [] },
    memberEnvelopes: [],
    state: { ...leg.state, prevStateHash: "0".repeat(64) },
  });
  const created = await createGroupRequest({
    actor: f.owner,
    groupId: crypto.randomUUID(),
    name: "Stale",
  });
  const responses = [
    await routeApp.request(`/organizations/${f.organizationId}/groups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${f.owner.token}`,
      },
      body: JSON.stringify({
        ...created,
        initialGroupPolicy: {
          ...created.initialGroupPolicy,
          memberEnvelopeChanges: { removeUserIds: [], upsert: [] },
        },
      }),
    }),
    await routeApp.request(`/organizations/${f.organizationId}/groups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${f.owner.token}`,
      },
      body: JSON.stringify({
        ...created,
        organizationPolicy: stale(created.organizationPolicy),
      }),
    }),
    await routeApp.request(
      `/organizations/${f.organizationId}/groups/${f.groupId}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${f.owner.token}`,
        },
        body: JSON.stringify({
          organizationPolicy: stale(created.organizationPolicy),
        }),
      },
    ),
  ];
  const [founding, ...stales] = responses;
  expect(founding?.status).toBe(400);
  expect(await founding?.json()).toEqual({
    error: "Member envelope changes need a predecessor state",
  });
  for (const response of stales) {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Member envelope changes cite an unknown predecessor state",
    });
  }
  expect(
    (
      await runGetCurrentPrincipalPolicyWorkflow(
        db,
        "organization",
        f.organizationId,
      )
    ).currentState.stateHash,
  ).toBe(directory.currentState.stateHash);
});

test("changes that do not rebuild the signed root are refused whole", async () => {
  const f = await groupWithSameEpochAdd();
  const full = await f.sign(f.current.keyEpoch, [...f.retained, f.added]);
  // The right recipient and fingerprint, wrapping other key material.
  const forged = { ...f.added, wrappedKey: f.retained[0]?.wrappedKey ?? "" };
  const { response } = await commit(f, byReference(full, [forged]));
  expect(response.status).toBe(400);
  expect(await response.text()).toContain(
    "Principal state memberEnvelopesRoot does not match member envelopes",
  );
  expect(
    (await runGetCurrentPrincipalPolicyWorkflow(db, "group", f.groupId))
      .currentState.stateHash,
  ).toBe(f.current.stateHash);
});

test("a leg sending both a list and changes is refused", async () => {
  const f = await groupWithSameEpochAdd();
  const full = await f.sign(f.current.keyEpoch, [...f.retained, f.added]);
  const { response } = await commit(f, {
    ...byReference(full, [f.added]),
    memberEnvelopes: full.memberEnvelopes,
  });
  expect(response.status).toBe(400);
  expect(await response.text()).toContain(
    "Member envelope changes replace the envelope list, which must be empty",
  );
});

test("changes are refused outside the predecessor's key epoch", async () => {
  const f = await groupWithSameEpochAdd();
  const advanced = await f.sign(f.current.keyEpoch + 1, [
    ...f.retained,
    f.added,
  ]);
  const { response } = await commit(f, byReference(advanced, [f.added]));
  expect(response.status).toBe(400);
  expect(await response.text()).toContain(
    "Member envelope changes require the predecessor's key epoch",
  );
});
