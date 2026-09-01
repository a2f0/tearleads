import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isOrganizationReadModelResponse,
  isPrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createPrincipalMemberEnvelopes } from "../../../test/helpers/principalMemberEnvelopes";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function getDefaultOrganizationId(userId: string): Promise<string> {
  const [user] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  invariant(user, "expected registered user");
  return user.organizationId;
}

function readModelPath(organizationId: string, cursor?: string): string {
  const path = `/organizations/${organizationId}/read-model`;
  return cursor === undefined
    ? path
    : `${path}?${new URLSearchParams({ cursor }).toString()}`;
}

test("organization policy transitions publish strict policy-head deltas", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const authorization = { Authorization: `Bearer ${actor.token}` };

  const snapshotResponse = await routeApp.request(
    readModelPath(organizationId),
    { headers: authorization },
  );
  const snapshot = await snapshotResponse.json();
  invariant(
    isOrganizationReadModelResponse(snapshot) && snapshot.mode === "snapshot",
    "expected organization read-model snapshot",
  );

  const policyResponse = await routeApp.request(
    `/principals/organization/${organizationId}/policy`,
    { headers: authorization },
  );
  const currentPolicy = await policyResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(currentPolicy),
    "expected organization policy bundle",
  );
  expect(snapshot.lanes.organizationPolicy).toEqual({
    organizationId,
    currentState: {
      stateHash: currentPolicy.currentState.stateHash,
      version: currentPolicy.currentState.version,
      keyEpoch: currentPolicy.currentState.keyEpoch,
      keyFingerprint: currentPolicy.currentState.keyFingerprint,
      memberCount: currentPolicy.currentState.memberCount,
    },
  });

  const principalKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection: currentPolicy.currentProjection,
    });
  const successor = await signPrincipalStateBundle({
    principalType: "organization",
    principalId: organizationId,
    version: currentPolicy.currentState.version + 1,
    prevStateHash: currentPolicy.currentState.stateHash,
    keyEpoch: currentPolicy.currentState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection: currentPolicy.currentProjection,
    payloadCiphertext: currentPolicy.currentPayload.ciphertext,
    externalAuthority: null,
    signedAt: "2026-07-17T20:00:00.000Z",
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    memberEnvelopes,
  });

  const putPath = `/principals/organization/${organizationId}/policy`;
  const putInit = {
    method: "PUT",
    headers: {
      ...authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(successor),
  };
  const putResponse = await routeApp.request(putPath, putInit);
  expect(putResponse.status).toBe(200);
  const storedSuccessor = await putResponse.json();
  invariant(
    isPrincipalPolicyBundleResponse(storedSuccessor),
    "expected stored organization policy successor",
  );

  const deltaResponse = await routeApp.request(
    readModelPath(organizationId, snapshot.nextCursor),
    { headers: authorization },
  );
  const delta = await deltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(delta) && delta.mode === "delta",
    "expected organization policy delta",
  );
  expect(delta.lanes).toEqual({
    organizationPolicy: {
      organizationId,
      currentState: {
        stateHash: storedSuccessor.currentState.stateHash,
        version: storedSuccessor.currentState.version,
        keyEpoch: storedSuccessor.currentState.keyEpoch,
        keyFingerprint: storedSuccessor.currentState.keyFingerprint,
        memberCount: storedSuccessor.currentState.memberCount,
      },
    },
  });

  const replayResponse = await routeApp.request(putPath, putInit);
  expect(replayResponse.status).toBe(200);
  const replayDeltaResponse = await routeApp.request(
    readModelPath(organizationId, delta.nextCursor),
    { headers: authorization },
  );
  const replayDelta = await replayDeltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(replayDelta) &&
      replayDelta.mode === "delta",
    "expected delta after exact organization policy replay",
  );
  expect(replayDelta.lanes).toEqual({});
  expect(replayDelta.nextCursor).toBe(delta.nextCursor);

  const rejectedResponse = await routeApp.request(putPath, {
    ...putInit,
    body: JSON.stringify({
      ...successor,
      state: { ...successor.state, signature: "invalid-signature" },
    }),
  });
  expect(rejectedResponse.status).toBe(403);
  const rejectedDeltaResponse = await routeApp.request(
    readModelPath(organizationId, delta.nextCursor),
    { headers: authorization },
  );
  const rejectedDelta = await rejectedDeltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(rejectedDelta) &&
      rejectedDelta.mode === "delta",
    "expected delta after rejected organization policy",
  );
  expect(rejectedDelta.lanes).toEqual({});
  expect(rejectedDelta.nextCursor).toBe(delta.nextCursor);
}, 10_000);
