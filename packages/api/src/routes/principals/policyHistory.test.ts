import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { isPrincipalPolicyHistoryResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedPrincipalState } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function putPolicy(input: {
  actor: TestUser;
  members: { principalId: string; principalType: "user" }[];
  principalId: string;
  prevStateHash?: string;
  version?: number;
}) {
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: input.principalId,
    members: input.members,
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
    ...(input.version === undefined ? {} : { version: input.version }),
    ...(input.prevStateHash === undefined
      ? {}
      : { prevStateHash: input.prevStateHash }),
  });

  const response = await routeApp.request(
    `/principals/group/${input.principalId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.actor.token}`,
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
  return signedState;
}

async function getHistory(
  principalId: string,
  token: string,
  query = "",
): Promise<Response> {
  return routeApp.request(
    `/principals/group/${principalId}/policy-history${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

test("policy-history serves the requester's own states newest first", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const principalId = crypto.randomUUID();

  await putPolicy({
    actor,
    members: [{ principalType: "user", principalId: actor.userId }],
    principalId,
  });

  const response = await getHistory(principalId, actor.token);
  expect(response.status).toBe(200);
  const history = await response.json();
  invariant(
    isPrincipalPolicyHistoryResponse(history),
    "expected a policy history response",
  );

  expect(history.principalId).toBe(principalId);
  expect(history.entries.length).toBeGreaterThan(0);
  const newest = history.entries[0];
  invariant(newest, "expected a newest entry");
  expect(newest.state.principalId).toBe(principalId);
  // Newest first, and the genesis state roots the chain.
  expect(newest.state.version).toBe(1);
  expect(newest.state.prevStateHash).toBeNull();

  // The envelopes are the whole point: the chain alone was already available
  // through the policy bundle's `previousStates`.
  expect(
    newest.memberEnvelopes.some(
      (envelope) =>
        envelope.memberPrincipalType === "user" &&
        envelope.memberPrincipalId === actor.userId,
    ),
  ).toBe(true);
}, 20_000);

test("policy-history discloses no key material to a non-member", async () => {
  const actor = createTestUser();
  const outsider = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  await registerUser(outsider);
  await authenticate(outsider);
  const principalId = crypto.randomUUID();

  await putPolicy({
    actor,
    members: [{ principalType: "user", principalId: actor.userId }],
    principalId,
  });

  const response = await getHistory(principalId, outsider.token);
  expect(response.status).toBe(200);
  const history = await response.json();
  invariant(
    isPrincipalPolicyHistoryResponse(history),
    "expected a policy history response",
  );

  // The state chain itself is not new disclosure — `getCurrentPrincipalPolicy`
  // already ships all of `previousStates` to any authenticated caller, and the
  // chain has to be contiguous for a client to verify it at all. What must
  // never leak is the key material: an outsider gets no envelope on any state.
  expect(history.entries.length).toBeGreaterThan(0);
  expect(
    history.entries.every((entry) => entry.memberEnvelopes.length === 0),
  ).toBe(true);
}, 20_000);

test("policy-history rejects an out-of-domain cursor without a 500", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const principalId = crypto.randomUUID();

  await putPolicy({
    actor,
    members: [{ principalType: "user", principalId: actor.userId }],
    principalId,
  });

  // A safe integer can still exceed PostgreSQL's `integer` range; a malformed
  // cursor must read as "from the newest state", not reach the query.
  for (const cursor of ["9007199254740991", "-1", "not-a-number"]) {
    const response = await getHistory(
      principalId,
      actor.token,
      `?beforeVersion=${cursor}`,
    );
    expect(response.status).toBe(200);
    const history = await response.json();
    invariant(
      isPrincipalPolicyHistoryResponse(history),
      "expected a policy history response",
    );
    expect(history.entries.length).toBeGreaterThan(0);
  }
}, 20_000);

test("policy-history requires authentication", async () => {
  const principalId = crypto.randomUUID();
  const response = await routeApp.request(
    `/principals/group/${principalId}/policy-history`,
  );
  expect(response.status).toBe(401);
}, 20_000);
