import { expect, test } from "bun:test";
import { computePrincipalMemberEnvelopesRoot } from "../principalMemberEnvelopes";
import { verifyPrincipalPolicyBundle } from "./index";
import {
  createBundle,
  createPolicySigner,
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";

test("verifyPrincipalPolicyBundle rejects member envelopes that do not match the signed root", async () => {
  const signer = await createPolicySigner();
  const current = await signPolicyState({
    principalId: "group-member-envelope-root-mismatch",
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }],
    signer,
  });
  const bundle = createBundle({ current });

  const result = await verifyPrincipalPolicyBundle({
    bundle: {
      ...bundle,
      currentMemberEnvelopes: {
        ...bundle.currentMemberEnvelopes,
        envelopes: [],
      },
    },
    signerPublicKeys: [signer],
  });

  expectVerificationError(result, "hash_mismatch");
});

test("verifyPrincipalPolicyBundle rejects signed envelopes outside the projection", async () => {
  const signer = await createPolicySigner();
  const base = await signPolicyState({
    principalId: "group-member-envelope-projection-mismatch",
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }],
    signer,
  });
  const signerEnvelope = base.memberEnvelopes[0];
  if (!signerEnvelope) {
    throw new Error("Expected signer envelope");
  }
  const extraEnvelope = {
    ...signerEnvelope,
    userId: "user-outside-projection",
    memberKeyFingerprint: "2".repeat(64),
  };
  const current = await signPolicyState({
    principalId: "group-member-envelope-projection-mismatch",
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }],
    memberEnvelopes: [signerEnvelope, extraEnvelope],
    signer,
  });

  expect(
    await computePrincipalMemberEnvelopesRoot(current.memberEnvelopes),
  ).toBe(current.state.memberEnvelopesRoot);

  const result = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current }),
    signerPublicKeys: [signer],
  });

  if (result.ok) {
    throw new Error("Expected verification to fail");
  }
  expect(result.error.code).toBe("hash_mismatch");
  expect(result.error.message).toBe(
    "principal policy member envelopes do not match current projection",
  );
});
