import { beforeAll, expect, test } from "bun:test";
import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  createPrincipalPolicyHistoryVerifier,
  type KeyingVerificationResult,
  verifyPrincipalPolicyBundle,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { signedRecoveryHistory } from "../../../test/helpers/principalHistoryRecovery";
import { collectPrincipalPolicySignerPublicKeys } from "../../workflows/principals/policyVerification";
import { assertBundleMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyBundle";
import { assertCurrentMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyCurrent";

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function createFixture() {
  const fixture = await signedRecoveryHistory(3);
  const { previousStates, ...current } = fixture.bundle;
  const keys = await collectPrincipalPolicySignerPublicKeys(fixture);
  if ("error" in keys) throw new Error(keys.error);
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalType: "group",
    principalId: current.currentState.principalId,
  });
  accepted(
    await verifier.append({
      entries: [
        ...previousStates,
        {
          state: current.currentState,
          projection: current.currentProjection,
          grants: current.currentGrants,
        },
      ],
      signerPublicKeys: keys.signerPublicKeys,
    }),
  );
  const history = accepted(verifier.finish(fixture.expectedHead));
  const policy = accepted(
    await verifyPrincipalPolicyCurrent({ current, history }),
  );
  const fullPolicy = accepted(
    await verifyPrincipalPolicyBundle({
      bundle: fixture.bundle,
      signerPublicKeys: keys.signerPublicKeys,
    }),
  );
  return { bundle: fixture.bundle, current, fullPolicy, policy };
}

let fixture: Awaited<ReturnType<typeof createFixture>>;
beforeAll(async () => {
  fixture = await createFixture();
});

test("current artifacts bind to sparse verified evidence without a full history", async () => {
  expect(fixture.current).not.toHaveProperty("previousStates");
  expect(fixture.policy).not.toHaveProperty("history");
  expect(fixture.policy.retainedHistory).toHaveLength(1);
  expect(fixture.policy.version).toBe(3);
  await expect(
    assertCurrentMatchesVerifiedPolicy({
      current: fixture.current,
      policy: fixture.policy,
    }),
  ).resolves.toBeUndefined();
});

const substitutions: {
  name: string;
  mutate: (current: PrincipalPolicyPageCurrent) => void;
}[] = [
  {
    name: "signature",
    mutate: (c) => {
      c.currentState.signature = "replaced";
    },
  },
  {
    name: "head",
    mutate: (c) => {
      c.currentState.stateHash = "0".repeat(64);
    },
  },
  {
    name: "projection",
    mutate: (c) => {
      c.currentProjection = [];
    },
  },
  {
    name: "grants",
    mutate: (c) => {
      c.currentGrants = [{ containerId: "other", accessLevel: "read" }];
    },
  },
  {
    name: "payload",
    mutate: (c) => {
      c.currentPayload.ciphertext += "replaced";
    },
  },
  {
    name: "payload principal",
    mutate: (c) => {
      c.currentPayload.principalId = "other";
    },
  },
  {
    name: "payload head",
    mutate: (c) => {
      c.currentPayload.stateHash = "0".repeat(64);
    },
  },
  {
    name: "payload hash",
    mutate: (c) => {
      c.currentPayload.ciphertextHash = "0".repeat(64);
    },
  },
  {
    name: "envelopes",
    mutate: (c) => {
      c.currentMemberEnvelopes.envelopes = [];
    },
  },
  {
    name: "envelope principal",
    mutate: (c) => {
      c.currentMemberEnvelopes.principalId = "other";
    },
  },
  {
    name: "envelope head",
    mutate: (c) => {
      c.currentMemberEnvelopes.stateHash = "0".repeat(64);
    },
  },
  {
    name: "envelope epoch",
    mutate: (c) => {
      c.currentMemberEnvelopes.epoch += 1;
    },
  },
];

test.each(substitutions)(
  "a $name substitution cannot bind to the verified current policy",
  async ({ mutate }) => {
    const current = structuredClone(fixture.current);
    mutate(current);
    await expect(
      assertCurrentMatchesVerifiedPolicy({
        current,
        policy: fixture.policy,
      }),
    ).rejects.toMatchObject({ code: "equivocation" });
  },
);

test("full-bundle admission still requires its complete verified history", async () => {
  await expect(
    assertBundleMatchesVerifiedPolicy({
      bundle: fixture.bundle,
      policy: fixture.fullPolicy,
    }),
  ).resolves.toBeUndefined();
  await expect(
    assertBundleMatchesVerifiedPolicy({
      bundle: { ...fixture.bundle, previousStates: [] },
      policy: fixture.fullPolicy,
    }),
  ).rejects.toMatchObject({ code: "equivocation" });
});
