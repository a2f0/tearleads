import { expect, test } from "bun:test";
import {
  db,
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
  ).map(({ role, userId }) => ({ role, userId }));
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
// 133 / 137.
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

  expect(create).toBeLessThanOrEqual(119);
  expect(commit).toBeLessThanOrEqual(137);
});
