import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  isPrincipalPolicyBundleResponse,
  isPrincipalPolicyHistoryResponse,
} from "@tearleads/validators/response";
import { PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT } from "@tearleads/validators/util";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedPrincipalState } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function putPolicy(input: {
  actor: TestUser;
  members: { principalId: string; principalType: "user" }[];
  principalId: string;
  // The principal's KEM keypair is carried across versions; a fresh one per
  // PUT is a key rotation the successor rules reject.
  principalKem?: ReturnType<typeof generateKemSeedAndKeyPair>;
  prevStateHash?: string;
  version?: number;
}) {
  const signedState = await createSignedPrincipalState({
    principalType: "group",
    principalId: input.principalId,
    members: input.members,
    ...(input.principalKem === undefined
      ? {}
      : { principalKem: input.principalKem }),
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
  // The server computes the state hash, so read it back rather than guessing:
  // the next version has to name it in prevStateHash.
  const stored = await response.json();
  invariant(
    isPrincipalPolicyBundleResponse(stored),
    "expected a principal policy bundle response",
  );
  return stored.currentState;
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

test("policy-history pages a multi-version chain contiguously", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const principalId = crypto.randomUUID();

  // Three accepted states, so paging has something to walk and each entry's
  // prevStateHash has a neighbour to name.
  const principalKem = generateKemSeedAndKeyPair();
  let prevStateHash: string | undefined;
  for (let version = 1; version <= 3; version += 1) {
    const signed = await putPolicy({
      actor,
      members: [{ principalType: "user", principalId: actor.userId }],
      principalId,
      principalKem,
      ...(version === 1 ? {} : { version }),
      ...(prevStateHash === undefined ? {} : { prevStateHash }),
    });
    prevStateHash = signed.stateHash;
  }

  const response = await getHistory(principalId, actor.token);
  expect(response.status).toBe(200);
  const history = await response.json();
  invariant(
    isPrincipalPolicyHistoryResponse(history),
    "expected a policy history response",
  );

  // Newest first, strictly descending, and contiguous: every entry's
  // prevStateHash names the entry below it. That linkage is what the client
  // walk verifies, so it has to hold on the wire.
  const versions = history.entries.map((entry) => entry.state.version);
  expect(versions).toEqual([...versions].sort((a, b) => b - a));
  for (const [index, entry] of history.entries.entries()) {
    const older = history.entries[index + 1];
    if (!older) continue;
    expect(entry.state.prevStateHash).toBe(older.state.stateHash);
  }

  // The cursor excludes its own version, so paging from the newest yields
  // strictly older states and cannot loop.
  const newest = history.entries[0];
  invariant(newest, "expected a newest entry");
  const nextPage = await getHistory(
    principalId,
    actor.token,
    `?beforeVersion=${newest.state.version}`,
  );
  const older = await nextPage.json();
  invariant(
    isPrincipalPolicyHistoryResponse(older),
    "expected a policy history response",
  );
  expect(
    older.entries.every((entry) => entry.state.version < newest.state.version),
  ).toBe(true);
}, 30_000);

test("policy-history fills a page and links across the page boundary", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const principalId = crypto.randomUUID();
  const principalKem = generateKemSeedAndKeyPair();

  // One more state than a page holds, so the first page comes back full with
  // hasMore set and the cursor has to carry the walk across the boundary.
  const total = PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT + 1;
  let prevStateHash: string | undefined;
  for (let version = 1; version <= total; version += 1) {
    const signed = await putPolicy({
      actor,
      members: [{ principalType: "user", principalId: actor.userId }],
      principalId,
      principalKem,
      ...(version === 1 ? {} : { version }),
      ...(prevStateHash === undefined ? {} : { prevStateHash }),
    });
    prevStateHash = signed.stateHash;
  }

  const firstResponse = await getHistory(principalId, actor.token);
  const first = await firstResponse.json();
  invariant(
    isPrincipalPolicyHistoryResponse(first),
    "expected a policy history response",
  );
  expect(first.entries.length).toBe(PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT);
  expect(first.hasMore).toBe(true);

  const oldestOnPage = first.entries.at(-1);
  invariant(oldestOnPage, "expected an oldest entry");

  const secondResponse = await getHistory(
    principalId,
    actor.token,
    `?beforeVersion=${oldestOnPage.state.version}`,
  );
  const second = await secondResponse.json();
  invariant(
    isPrincipalPolicyHistoryResponse(second),
    "expected a policy history response",
  );

  // The boundary must chain: the newest entry of the next page is exactly the
  // state the previous page's oldest entry names as its predecessor. The
  // client walk carries that hash forward and rejects a page that breaks it.
  const newestOnNext = second.entries[0];
  invariant(newestOnNext, "expected a next-page entry");
  const boundaryHash = oldestOnPage.state.prevStateHash;
  invariant(boundaryHash, "expected the page boundary to name a predecessor");
  expect(newestOnNext.state.stateHash).toBe(boundaryHash);
  expect(newestOnNext.state.version).toBe(oldestOnPage.state.version - 1);
  expect(second.hasMore).toBe(false);
}, 300_000);

test("policy-history serves no envelope for a group the requester cannot reach", async () => {
  const actor = createTestUser();
  const outsider = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  await registerUser(outsider);
  await authenticate(outsider);
  const principalId = crypto.randomUUID();

  // The state carries a member envelope addressed to the actor. The outsider
  // reaches neither the actor's user principal nor any group in the
  // projection, so the scope must yield them nothing — this is the
  // key-disclosure boundary, and it is enforced in SQL rather than by the
  // caller remembering to filter.
  await putPolicy({
    actor,
    members: [{ principalType: "user", principalId: actor.userId }],
    principalId,
  });

  const mine = await (await getHistory(principalId, actor.token)).json();
  invariant(
    isPrincipalPolicyHistoryResponse(mine),
    "expected a policy history response",
  );
  expect(
    mine.entries.some((entry) =>
      entry.memberEnvelopes.some(
        (envelope) =>
          envelope.memberPrincipalType === "user" &&
          envelope.memberPrincipalId === actor.userId,
      ),
    ),
  ).toBe(true);

  const theirs = await (await getHistory(principalId, outsider.token)).json();
  invariant(
    isPrincipalPolicyHistoryResponse(theirs),
    "expected a policy history response",
  );
  // Same states, zero key material — and specifically never the actor's.
  expect(theirs.entries.length).toBe(mine.entries.length);
  expect(
    theirs.entries.every((entry) => entry.memberEnvelopes.length === 0),
  ).toBe(true);
}, 30_000);
