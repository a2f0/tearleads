import { expect, mock, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  buildPrincipalStateSigningInput,
  computeUserIdentityBundleFingerprint,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import type { RegistrationRequest } from "@tearleads/validators/request";
import invariant from "invariant";
import { createRegistrationRequestBody } from "../../../test/helpers/api/submitRegistration";
import { readRegistrationArtifacts } from "../../../test/helpers/registration/artifacts";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { createRouteApp } from "../../routeApp";
import * as policyStore from "../../workflows/principals/storeVerifiedPrincipalPolicy";

const publicOrigin = "https://registration.test";
const identityTrustDomain = `${publicOrigin}/api`;

type Substitution =
  | "signingPublicKey"
  | "encapsulationPublicKey"
  | "identityTrustDomain";

async function fixture(substitution: Substitution) {
  const user = createTestUser();
  const other = createTestUser();
  const request = await createRegistrationRequestBody(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
    { identityTrustDomain },
  );
  const validPolicy = request.initialOrganizationPolicy;
  const validFingerprint = validPolicy.projection[0]?.identityBundleFingerprint;
  invariant(validFingerprint, "expected the registering identity commitment");
  const identity = {
    userId: request.userId,
    identityTrustDomain,
    signingPublicKey: user.signing.signingPublicKey,
    encapsulationPublicKey: user.kem.publicKey,
  };
  const substitutes = {
    signingPublicKey: other.signing.signingPublicKey,
    encapsulationPublicKey: other.kem.publicKey,
    identityTrustDomain: publicOrigin,
  };
  const wrongFingerprint = await computeUserIdentityBundleFingerprint({
    ...identity,
    [substitution]: substitutes[substitution],
  });
  const projection = validPolicy.projection.map((member) => ({
    ...member,
    identityBundleFingerprint: wrongFingerprint,
  }));
  // Re-sign the complete, structurally valid policy; signature/root guards must
  // not be responsible for rejecting an identity substitution.
  request.initialOrganizationPolicy = {
    ...validPolicy,
    projection,
    state: await signPrincipalState(
      await buildPrincipalStateSigningInput({
        ...validPolicy.state,
        members: projection.map(({ userId }) => ({ userId })),
        memberEnvelopes: validPolicy.memberEnvelopes,
        projection,
        grants: validPolicy.grants,
        payloadCiphertext: validPolicy.encryptedPayload.ciphertext,
      }),
      user.signing.signingPrivateKey,
    ),
  };
  expect(wrongFingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(wrongFingerprint).not.toBe(validFingerprint);
  return {
    request,
    validPolicy,
    validFingerprint,
    fingerprint: await toFingerprint(user.signing.signingPublicKey),
  };
}

async function submitWithStagingObserver(
  submit: () => Promise<Response>,
  request: RegistrationRequest,
) {
  let staged: Awaited<ReturnType<typeof readRegistrationArtifacts>> | undefined;
  const store = policyStore.storeVerifiedPrincipalPolicyInTransaction;
  const observer = spyOn(
    policyStore,
    "storeVerifiedPrincipalPolicyInTransaction",
  ).mockImplementation(async (bundle, tx, options) => {
    if (bundle.state.principalId === request.organizationId) {
      staged = await readRegistrationArtifacts(tx, request);
    }
    return store(bundle, tx, options);
  });
  try {
    const response = await submit();
    invariant(staged, "expected registration to reach the final policy guard");
    return { response, staged };
  } finally {
    observer.mockRestore();
  }
}

test.each([
  "signingPublicKey",
  "encapsulationPublicKey",
  "identityTrustDomain",
] as const)(
  "POST /auth/register rejects signed %s substitution and rolls back staged identities and policies",
  async (substitution) => {
    const { request, validPolicy, validFingerprint, fingerprint } =
      await fixture(substitution);
    const runtime = { ...createServiceTestRuntime(), identityTrustDomain };
    const publish = mock(async () => {});
    runtime.eventPublisher = { publish };
    // Authentication origin stays bare; identity scope retains the API base path.
    const app = createRouteApp({ runtime }, { publicOrigin });
    const submit = async () =>
      app.request(`${publicOrigin}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    const { response, staged } = await submitWithStagingObserver(
      submit,
      request,
    );
    expect(response.status, await response.clone().text()).toBe(400);
    expect(await response.json()).toEqual({
      error: `Principal member identity bundle mismatch for ${request.userId}`,
    });
    expect(staged.users).toMatchObject([
      {
        id: request.userId,
        signingPublicKey: request.signingPublicKey,
        encapsulationPublicKey: request.encapsulationPublicKey,
      },
    ]);
    const groupIds = [
      request.initialAdminGroup.groupId,
      request.initialMemberGroup.groupId,
    ].sort();
    for (const rows of [
      staged.states,
      staged.payloads,
      staged.projection,
      staged.envelopes,
    ]) {
      expect(rows.map(({ principalId }) => principalId).sort()).toEqual(
        groupIds,
      );
    }
    for (const member of staged.projection) {
      expect(member.identityBundleFingerprint).toBe(validFingerprint);
    }
    // The two complete group policies and newly inserted user really existed
    // inside this transaction; absence now therefore proves rollback, not preflight.
    for (const [table, rows] of Object.entries(
      await readRegistrationArtifacts(db, request),
    )) {
      expect(rows, table).toHaveLength(0);
    }
    expect(publish).not.toHaveBeenCalled();
    expect(
      await runtime.keyValueStore.get(`challenge:${fingerprint}`),
    ).toBeNull();
    request.initialOrganizationPolicy = validPolicy;
    const retry = await submit();
    expect(retry.status, await retry.clone().text()).toBe(200);
    const committed = await readRegistrationArtifacts(db, request);
    expect(committed.projection).toHaveLength(3);
    for (const member of committed.projection) {
      expect(member.identityBundleFingerprint).toBe(validFingerprint);
    }
    expect(committed.users).toHaveLength(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(
      await runtime.keyValueStore.get(`challenge:${fingerprint}`),
    ).not.toBeNull();
  },
);
