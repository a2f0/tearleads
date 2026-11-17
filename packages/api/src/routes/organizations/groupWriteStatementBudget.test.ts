import { expect, test } from "bun:test";
import {
  db,
  getDefaultApiDatabaseKind,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import {
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  getCurrentPrincipalState,
  getPrincipalStatePayloadForState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

async function countStatements(run: () => Promise<Response>) {
  const counter = { statements: 0 };
  const response = await withDatabaseStatementCounter(counter, run);
  expect(response.status).toBe(200);
  return counter.statements;
}

function postGroup(actor: TestUser, organizationId: string, body: unknown) {
  return routeApp.request(`/organizations/${organizationId}/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${actor.token}`,
    },
    body: JSON.stringify(body),
  });
}

/** The group's successor: same members and name, rotated principal key. */
async function signGroupSuccessor(actor: TestUser, groupId: string) {
  const current = await getCurrentPrincipalState("group", groupId, db);
  invariant(current, "expected the group policy");
  const payload = await getPrincipalStatePayloadForState(
    "group",
    groupId,
    current.stateHash,
    db,
  );
  invariant(payload, "expected the group payload");
  const projection = (
    await listCurrentPrincipalProjectionMembers("group", groupId, db)
  ).map(({ role, userId, identityBundleFingerprint }) => ({
    role,
    userId,
    identityBundleFingerprint,
  }));
  const principalKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });
  const signed = await signPrincipalStateBundle({
    principalType: "group",
    principalId: groupId,
    version: current.version + 1,
    prevStateHash: current.stateHash,
    keyEpoch: current.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    grants: [],
    externalAuthority: null,
    payloadCiphertext: payload.ciphertext,
    signedAt: new Date("2026-05-13T12:00:00.000Z").toISOString(),
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    memberEnvelopes,
  });
  return {
    state: signed.state,
    encryptedPayload: signed.encryptedPayload,
    projection: signed.projection,
    grants: signed.grants,
    memberEnvelopes: signed.memberEnvelopes,
  };
}

// Bounds are the Postgres counts, which include the two transaction-control
// statements PGlite hides. Before per-transaction memos of current principal
// states and organization descriptors under their locks: create 132 (PGlite
// and SQLite) / 134 (Postgres), commit 155 / 159. After: 117 / 119 and
// 133 / 137. Once policy writes acknowledged heads instead of re-reading the
// stored bundle: 114 / 116 and 127 / 131. Batched history and verified
// projection handoffs plus the two identity-registry verification reads now
// measure 89 and 109 on PGlite. Skipping the held read-model head relock,
// reusing roster sync's Members reachability for seats and publishing the
// history progress rows in one upsert: 86 and 105. PostgreSQL keeps its two /
// four transaction-control allowances; admission reads remain at every
// original guard. A commit whose organization directory keeps its key
// measures the same 105 as one that rotates it, and sends the same bytes; the
// one statement it drops is the test helper's recipient read.
test("group create and group policy commit stay within their statement budgets", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const groupId = crypto.randomUUID();
  const createBody = await createGroupRequest({
    actor,
    groupId,
    name: "Operators",
  });

  const create = await countStatements(async () =>
    postGroup(actor, organizationId, createBody),
  );
  const groupPolicy = await signGroupSuccessor(actor, groupId);
  const commit = await countStatements(() =>
    submitOrganizationGroupPolicyCommit({
      actor,
      groupId,
      groupPolicy,
      organizationId,
      request: (path, init) => routeApp.request(path, init),
    }),
  );

  const nextGroupPolicy = await signGroupSuccessor(actor, groupId);
  const keptKeyCommit = await countStatements(() =>
    submitOrganizationGroupPolicyCommit({
      actor,
      groupId,
      groupPolicy: nextGroupPolicy,
      keepKeyWith: actor.kem.secretKey,
      organizationId,
      request: (path, init) => routeApp.request(path, init),
    }),
  );

  expect(create).toBeLessThanOrEqual(
    86 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
  for (const statements of [commit, keptKeyCommit])
    expect(statements).toBeLessThanOrEqual(
      105 + (getDefaultApiDatabaseKind() === "postgres" ? 4 : 0),
    );
});

// An Admins-governed create cites the current Admins head as its external
// authority. Registration publishes that head's strict Admins progress beside
// its policy progress, so the first such create commits without a 202
// preparation round (which re-ran the whole transaction: 142 statements).
test("the first Admins-governed group create stays within its statement budget", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const groupId = crypto.randomUUID();
  const createBody = await createGroupRequest({
    actor,
    groupId,
    includeActorAsAdmin: false,
    name: "Governed",
  });

  const create = await countStatements(async () =>
    postGroup(actor, organizationId, createBody),
  );

  expect(create).toBeLessThanOrEqual(
    90 + (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
  );
});
