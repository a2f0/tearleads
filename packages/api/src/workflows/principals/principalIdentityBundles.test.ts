import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import {
  computeUserIdentityBundleFingerprint,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  createIdentityBoundPolicy,
  identityTrustDomain,
} from "../../../test/helpers/identityBoundPolicy";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import {
  getCurrentPrincipalState,
  listProjectionMembersForState,
} from "../../access/read/principalStateStore";
import { assertPrincipalIdentityBundles } from "./principalIdentityBundles";
import { buildPrincipalPolicyCurrentForStateWithExecutor } from "./principalPolicyBundleRecords";
import { storeVerifiedPrincipalPolicyInTransaction } from "./storeVerifiedPrincipalPolicy";

const options = { identityTrustDomain };

for (const changed of [
  "identityTrustDomain",
  "userId",
  "encapsulationPublicKey",
] as const) {
  test(`valid signed policy rejects a member bundle with substituted ${changed}`, async () => {
    const { bundle, signer } = await createIdentityBoundPolicy({
      memberIdentityBundleFingerprint: (member) =>
        computeUserIdentityBundleFingerprint({
          ...member,
          [changed]:
            changed === "encapsulationPublicKey"
              ? generateKemSeedAndKeyPair().publicKey
              : changed === "userId"
                ? crypto.randomUUID()
                : "https://other.example.test",
        }),
    });
    expect(bundle.state.signerUserId).toBe(signer.userId);
    await expect(
      db.transaction((tx) =>
        storeVerifiedPrincipalPolicyInTransaction(bundle, tx, options),
      ),
    ).rejects.toThrow("Principal member identity bundle mismatch");
    expect(
      await getCurrentPrincipalState("group", bundle.state.principalId, db),
    ).toBeNull();
  });
}

test("registry checking uses one set read for distinct member identities", async () => {
  const { bundle } = await createIdentityBoundPolicy();
  expect(
    new Set(bundle.projection.map((member) => member.identityBundleFingerprint))
      .size,
  ).toBe(2);
  const counter = { statements: 0 };
  await withDatabaseStatementCounter(counter, () =>
    assertPrincipalIdentityBundles({
      ...bundle,
      executor: db,
      identityTrustDomain,
    }),
  );
  expect(counter.statements).toBe(1);
});

test("unknown projected users cannot be committed", async () => {
  const { bundle, member } = await createIdentityBoundPolicy();
  await db.delete(users).where(eq(users.id, member.userId));
  await expect(
    db.transaction((tx) =>
      storeVerifiedPrincipalPolicyInTransaction(bundle, tx, options),
    ),
  ).rejects.toThrow("Missing registered principal member identity");
  expect(
    await getCurrentPrincipalState("group", bundle.state.principalId, db),
  ).toBeNull();
});

test("envelopes bind to the same real KEM keys as the member identity bundles", async () => {
  const { signingInput, member, signer } = await createIdentityBoundPolicy();
  const bundle = await signPrincipalStateBundle({
    ...signingInput,
    memberEnvelopes: signingInput.memberEnvelopes.map((envelope) =>
      envelope.userId === member.userId
        ? {
            ...envelope,
            memberKeyFingerprint: signer.encapsulationKeyFingerprint,
          }
        : envelope,
    ),
  });
  await expect(
    db.transaction((tx) =>
      storeVerifiedPrincipalPolicyInTransaction(bundle, tx, options),
    ),
  ).rejects.toThrow("Principal member envelope identity key mismatch");
  expect(
    await getCurrentPrincipalState("group", bundle.state.principalId, db),
  ).toBeNull();
});

test("registry fingerprint columns cannot replace the actual public key bytes", async () => {
  const { signingInput, member, signer } = await createIdentityBoundPolicy();
  await db
    .update(users)
    .set({ encapsulationKeyFingerprint: signer.encapsulationKeyFingerprint })
    .where(eq(users.id, member.userId));
  const bundle = await signPrincipalStateBundle({
    ...signingInput,
    memberEnvelopes: signingInput.memberEnvelopes.map((envelope) =>
      envelope.userId === member.userId
        ? {
            ...envelope,
            memberKeyFingerprint: signer.encapsulationKeyFingerprint,
          }
        : envelope,
    ),
  });
  await expect(
    db.transaction((tx) =>
      storeVerifiedPrincipalPolicyInTransaction(bundle, tx, options),
    ),
  ).rejects.toThrow("Principal member identity bundle mismatch");
});

test("exact retries preserve the full committed projection", async () => {
  const { bundle } = await createIdentityBoundPolicy();
  const first = await db.transaction((tx) =>
    storeVerifiedPrincipalPolicyInTransaction(bundle, tx, options),
  );
  const replay = await db.transaction((tx) =>
    storeVerifiedPrincipalPolicyInTransaction(bundle, tx, options),
  );
  expect(replay).toEqual(first);
});

test("identity-bound projections round-trip through storage and response selectors", async () => {
  const { bundle } = await createIdentityBoundPolicy();
  const state = await db.transaction((tx) =>
    storeVerifiedPrincipalPolicyInTransaction(bundle, tx, options),
  );
  const projection = await listProjectionMembersForState(
    "group",
    state.principalId,
    state.stateHash,
    db,
  );
  expect(
    projection.map(({ userId, role, identityBundleFingerprint }) => ({
      userId,
      role,
      identityBundleFingerprint,
    })),
  ).toEqual(bundle.projection);
  const response = await buildPrincipalPolicyCurrentForStateWithExecutor(
    db,
    state,
  );
  expect(response.currentProjection).toEqual(bundle.projection);
});

test("valid signed policy cannot substitute a non-signing member's identity bundle", async () => {
  const replacement = generateSigningSeedAndKeyPair();
  const { bundle } = await createIdentityBoundPolicy({
    memberIdentityBundleFingerprint: (member) =>
      computeUserIdentityBundleFingerprint({
        ...member,
        signingPublicKey: replacement.signingPublicKey,
      }),
  });
  await expect(
    db.transaction((tx) =>
      storeVerifiedPrincipalPolicyInTransaction(bundle, tx, options),
    ),
  ).rejects.toThrow("Principal member identity bundle mismatch");
  expect(
    await getCurrentPrincipalState("group", bundle.state.principalId, db),
  ).toBeNull();
});
