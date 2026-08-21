import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
  makeVerifiedPrincipalPolicy,
  toFingerprint,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { buildInitialGroupPolicyRequest } from "../../workflows/organizations/principalPolicy";
import { loadPrincipalPolicyCheckpoint } from "./keyingCheckpointPersistence";
import {
  persistLocallyAcknowledgedPrincipalPolicyBundle,
  persistLocallyAcknowledgedPrincipalPolicyBundles,
} from "./locallyAcknowledgedCheckpointPersistence";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "./principalPolicyPersistence";

async function policyFixture(principalId = crypto.randomUUID()) {
  const signer = generateSigningSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
    groupId: principalId,
    name: "Policy persistence",
    signerUserId,
    signingFingerprint: await toFingerprint(signer.signingPublicKey),
    signingKeyPair: signer,
  });
  const bundle = await policyBundleFromInitialRequest(request);
  const policy = makeVerifiedPrincipalPolicy({
    checkpoint: {
      principalId,
      principalType: "group",
      stateHash: bundle.currentState.stateHash,
      version: bundle.currentState.version,
    },
    history: [
      {
        state: bundle.currentState,
        projection: bundle.currentProjection,
        grants: bundle.currentGrants,
      },
    ],
    keyEpoch: bundle.currentState.keyEpoch,
    principalId,
    principalType: "group",
    projection: bundle.currentProjection,
    grants: bundle.currentGrants,
    state: bundle.currentState,
    stateHash: bundle.currentState.stateHash,
    version: bundle.currentState.version,
  });
  return { bundle, policy };
}

function securityVariant(
  bundle: PrincipalPolicyBundleResponse,
  kind: "envelopes" | "payload" | "projection",
): PrincipalPolicyBundleResponse {
  if (kind === "envelopes") {
    const first = bundle.currentMemberEnvelopes.envelopes[0];
    if (!first) {
      throw new Error("Expected a member envelope");
    }
    const wrappedKey = base64ToBytes(first.wrappedKey);
    wrappedKey[0] = (wrappedKey[0] ?? 0) ^ 1;
    return {
      ...bundle,
      currentMemberEnvelopes: {
        ...bundle.currentMemberEnvelopes,
        envelopes: [{ ...first, wrappedKey: bytesToBase64(wrappedKey) }],
      },
    };
  }
  if (kind === "payload") {
    return {
      ...bundle,
      currentPayload: {
        ...bundle.currentPayload,
        ciphertext: `${bundle.currentPayload.ciphertext}altered`,
      },
    };
  }
  const first = bundle.currentProjection[0];
  if (!first) {
    throw new Error("Expected a projection member");
  }
  return {
    ...bundle,
    currentProjection: [
      { ...first, role: first.role === "admin" ? "member" : "admin" },
    ],
  };
}

function successorBundle(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse {
  const stateHash = "2".repeat(64);
  return {
    ...bundle,
    currentState: {
      ...bundle.currentState,
      keyEpoch: bundle.currentState.keyEpoch + 1,
      prevStateHash: bundle.currentState.stateHash,
      stateHash,
      version: bundle.currentState.version + 1,
    },
    currentPayload: { ...bundle.currentPayload, stateHash },
    currentMemberEnvelopes: {
      ...bundle.currentMemberEnvelopes,
      epoch: bundle.currentState.keyEpoch + 1,
      stateHash,
    },
    previousStates: [
      {
        state: bundle.currentState,
        projection: bundle.currentProjection,
        grants: bundle.currentGrants,
      },
    ],
  };
}

test("same-head timestamp and envelope-order differences are a no-op", async () => {
  const { close, execSql } = await createTestExecSql(
    "acknowledged-policy-equivalence",
  );
  try {
    const { bundle, policy } = await policyFixture();
    const firstUpdatedAt = "2026-07-14T00:00:00.000Z";
    await persistLocallyAcknowledgedPrincipalPolicyBundle({
      bundle,
      execSql,
      policy,
      updatedAt: firstUpdatedAt,
    });
    const equivalent: PrincipalPolicyBundleResponse = {
      ...bundle,
      currentState: {
        ...bundle.currentState,
        createdAt: "2026-07-14T00:01:00.000Z",
      },
      currentPayload: {
        ...bundle.currentPayload,
        createdAt: "2026-07-14T00:01:00.000Z",
      },
      currentMemberEnvelopes: {
        ...bundle.currentMemberEnvelopes,
        envelopes: [...bundle.currentMemberEnvelopes.envelopes].reverse(),
      },
    };
    await savePrincipalPolicyBundle(
      execSql,
      equivalent,
      "2026-07-14T00:02:00.000Z",
    );

    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        policy.principalType,
        policy.principalId,
      ),
    ).resolves.toEqual(bundle);
    const rows = await execSql(
      `SELECT updated_at AS updatedAt FROM principal_policies
       WHERE principal_type = ? AND principal_id = ?`,
      [policy.principalType, policy.principalId],
    );
    expect(Reflect.get(rows[0] ?? {}, "updatedAt")).toBe(firstUpdatedAt);
  } finally {
    close();
  }
});

test("same-head history timestamps are not security conflicts", async () => {
  const { close, execSql } = await createTestExecSql(
    "acknowledged-policy-history-timestamps",
  );
  try {
    const { bundle } = await policyFixture();
    const successor = successorBundle(bundle);
    await savePrincipalPolicyBundle(
      execSql,
      successor,
      "2026-07-14T00:00:00.000Z",
    );
    const previous = successor.previousStates[0];
    if (!previous) {
      throw new Error("Expected policy history");
    }
    await savePrincipalPolicyBundle(
      execSql,
      {
        ...successor,
        currentState: {
          ...successor.currentState,
          createdAt: "2026-07-14T00:01:00.000Z",
        },
        currentPayload: {
          ...successor.currentPayload,
          createdAt: "2026-07-14T00:01:00.000Z",
        },
        previousStates: [
          {
            ...previous,
            state: {
              ...previous.state,
              createdAt: "2026-07-14T00:01:00.000Z",
            },
          },
        ],
      },
      "2026-07-14T00:02:00.000Z",
    );
    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        successor.currentState.principalType,
        successor.currentState.principalId,
      ),
    ).resolves.toEqual(successor);
  } finally {
    close();
  }
});

test.each([
  "envelopes",
  "payload",
  "projection",
] as const)("same-head %s conflicts preserve the acknowledged bundle", async (kind) => {
  const { close, execSql } = await createTestExecSql(
    `acknowledged-policy-${kind}-conflict`,
  );
  try {
    const { bundle, policy } = await policyFixture();
    await persistLocallyAcknowledgedPrincipalPolicyBundle({
      bundle,
      execSql,
      policy,
      updatedAt: "2026-07-14T00:00:00.000Z",
    });

    await expect(
      savePrincipalPolicyBundle(
        execSql,
        securityVariant(bundle, kind),
        "2026-07-14T00:01:00.000Z",
      ),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        policy.principalType,
        policy.principalId,
      ),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("same-head conflicts cannot replace an archived acknowledged bundle", async () => {
  const { close, execSql } = await createTestExecSql(
    "acknowledged-policy-archived-conflict",
  );
  try {
    const { bundle, policy } = await policyFixture();
    await persistLocallyAcknowledgedPrincipalPolicyBundle({
      bundle,
      execSql,
      policy,
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
    const successor = successorBundle(bundle);
    await savePrincipalPolicyBundle(
      execSql,
      successor,
      "2026-07-14T00:01:00.000Z",
    );

    await expect(
      savePrincipalPolicyBundle(
        execSql,
        securityVariant(bundle, "envelopes"),
        "2026-07-14T00:02:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "equivocation" });
    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        policy.principalType,
        policy.principalId,
      ),
    ).resolves.toEqual(successor);
  } finally {
    close();
  }
});

test("concurrent identical policy acknowledgements both succeed", async () => {
  const { close, execSql } = await createTestExecSql(
    "acknowledged-policy-concurrent-identical",
  );
  try {
    const { bundle, policy } = await policyFixture();
    const results = await Promise.allSettled(
      ["first", "second"].map((suffix) =>
        persistLocallyAcknowledgedPrincipalPolicyBundle({
          bundle,
          execSql,
          policy,
          updatedAt: `2026-07-14T00:00:00.000Z-${suffix}`,
        }),
      ),
    );
    expect(results.every((result) => result.status === "fulfilled")).toBeTrue();
    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        policy.principalType,
        policy.principalId,
      ),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("concurrent divergent same-head acknowledgements accept exactly one bundle", async () => {
  const { close, execSql } = await createTestExecSql(
    "acknowledged-policy-concurrent-conflict",
  );
  try {
    const { bundle, policy } = await policyFixture();
    const conflicting = securityVariant(bundle, "envelopes");
    const candidates = [bundle, conflicting];
    const results = await Promise.allSettled(
      candidates.map((candidate) =>
        persistLocallyAcknowledgedPrincipalPolicyBundle({
          bundle: candidate,
          execSql,
          policy,
          updatedAt: "2026-07-14T00:00:00.000Z",
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(KeyingVerificationError);
      expect((rejected.reason as KeyingVerificationError).code).toBe(
        "equivocation",
      );
    }
    const winner =
      candidates[results.findIndex((result) => result.status === "fulfilled")];
    if (!winner) {
      throw new Error("Expected one acknowledged policy bundle");
    }
    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        policy.principalType,
        policy.principalId,
      ),
    ).resolves.toEqual(winner);
  } finally {
    close();
  }
});

test("checkpoint write failure rolls back the acknowledged bundle", async () => {
  const { close, execSql } = await createTestExecSql(
    "acknowledged-policy-atomic-failure",
  );
  try {
    const { bundle, policy } = await policyFixture();
    await ensurePrincipalPolicyTables(execSql);
    await loadPrincipalPolicyCheckpoint(
      execSql,
      policy.principalType,
      policy.principalId,
    );
    await execSql(`CREATE TRIGGER reject_policy_checkpoint
      BEFORE INSERT ON principal_policy_checkpoints
      BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END`);

    await expect(
      persistLocallyAcknowledgedPrincipalPolicyBundles({
        entries: [{ bundle, policy }],
        execSql,
        updatedAt: "2026-07-14T00:00:00.000Z",
      }),
    ).rejects.toThrow();
    await expect(
      loadPrincipalPolicyCheckpoint(
        execSql,
        policy.principalType,
        policy.principalId,
      ),
    ).resolves.toBeNull();
    await expect(
      loadPrincipalPolicyBundle(
        execSql,
        policy.principalType,
        policy.principalId,
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
