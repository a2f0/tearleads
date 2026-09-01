import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { collectReferencedPrincipalPolicies } from "./principalPolicyVerification";

const REFERENCE: ReferencedPrincipalHead = {
  keyEpoch: 1,
  keyFingerprint: "group-key-fingerprint",
  principalId: "group-1",
  principalType: "group",
  stateHash: "group-state-hash",
  version: 1,
};

test("principal verification recognizes expiry after one warming pass", async () => {
  const database = await createTestExecSql(
    "principal-policy-verification-generation",
  );
  let current = true;
  let warmCount = 0;

  try {
    const verification = collectReferencedPrincipalPolicies({
      checkpointContext: createProjectionCheckpointContext({
        execSql: database.execSql,
      }),
      organizationId: "organization-1",
      principalPolicyCache: new Map(),
      references: [REFERENCE],
      resolveUserKey: async () => null,
      stillCurrent: () => current,
      warmReferencedPrincipalPolicies: async () => {
        warmCount += 1;
        current = false;
      },
    });

    await expect(verification).resolves.toEqual([]);
    expect(warmCount).toBe(1);
  } finally {
    database.close();
  }
});

test("principal verification does not invoke a legacy warmer after expiry", async () => {
  const database = await createTestExecSql(
    "principal-policy-verification-stale-warmer",
  );
  let guardChecks = 0;
  let warmCount = 0;

  try {
    const verification = collectReferencedPrincipalPolicies({
      checkpointContext: createProjectionCheckpointContext({
        execSql: database.execSql,
      }),
      organizationId: "organization-1",
      principalPolicyCache: new Map(),
      references: [REFERENCE],
      resolveUserKey: async () => null,
      stillCurrent: () => {
        guardChecks += 1;
        return guardChecks === 1;
      },
      warmReferencedPrincipalPolicies: async () => {
        warmCount += 1;
      },
    });

    await expect(verification).resolves.toEqual([]);
    expect(warmCount).toBe(0);
  } finally {
    database.close();
  }
});
