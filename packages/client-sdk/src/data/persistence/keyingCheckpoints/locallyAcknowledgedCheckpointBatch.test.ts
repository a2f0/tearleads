import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { advanceLocallyAcknowledgedAccessManifestHeadsAtomically as advance } from "./locallyAcknowledgedCheckpointPersistence";

test("expected policy guard keeps input order before a later malformed pin", async () => {
  const db = await createTestExecSql("acknowledged-policy-error-order");
  const expected = ["first", "second"].map((principalId) => ({
    principalId,
    principalType: "group" as const,
    version: 1,
    stateHash: "hash",
  }));
  try {
    await advance({ execSql: db.execSql, heads: [] });
    await db.execSql(
      "INSERT INTO principal_policy_checkpoints (principal_type, principal_id, organization_id, version, state_hash) VALUES ('group', 'second', 'organization', 1, NULL)",
    );
    await expect(
      advance({
        execSql: db.execSql,
        heads: [],
        expectedPrincipalPolicyCheckpoints: expected,
      }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    await expect(
      advance({
        execSql: db.execSql,
        heads: [],
        expectedPrincipalPolicyCheckpoints: expected.slice(1),
      }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
  } finally {
    await db.close();
  }
});

const heads = Array.from({ length: 32 }, (_, index) => ({
  checkpoint: {
    objectKind: "container" as const,
    organizationId: "organization",
    objectId: `container-${index}`,
    epoch: 1,
    manifestHash: "a".repeat(64),
  },
  previousManifestHash: null,
}));

test("acknowledged heads set-load guards before a bounded set write", async () => {
  const db = await createTestExecSql("acknowledged-head-set-budget");
  const counted = countingExecSql(db.execSql);
  try {
    await advance({ execSql: counted.execSql, heads: [] });
    expect(
      await counted.count(() => advance({ execSql: counted.execSql, heads })),
    ).toBe(5);
    expect(
      await counted.count(() =>
        advance({
          execSql: counted.execSql,
          heads,
          expectedAccessManifestCheckpoints: heads.map(
            (head) => head.checkpoint,
          ),
        }),
      ),
    ).toBe(5);
    const rows = await db.execSql("SELECT * FROM access_manifest_checkpoints");
    expect(rows).toHaveLength(32);
  } finally {
    await db.close();
  }
});

test("acknowledgement preserves expected, retirement, and duplicate error order", async () => {
  const db = await createTestExecSql("acknowledged-error-order");
  const head = heads[0];
  if (!head) throw new Error("Missing head fixture");
  try {
    await advance({ execSql: db.execSql, heads: [head] });
    await db.execSql(
      "INSERT INTO principal_grant_retirements (organization_id, container_id, principal_id, policy_state_hash) VALUES (?, ?, ?, ?)",
      ["organization", head.checkpoint.objectId, "principal", "retired"],
    );
    await expect(
      advance({
        execSql: db.execSql,
        heads: [head, head],
        expectedAccessManifestCheckpoints: [{ ...head.checkpoint, epoch: 2 }],
      }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    await expect(
      advance({ execSql: db.execSql, heads: [head, head] }),
    ).rejects.toThrow("was retired during principal rotation");
    await db.execSql("DELETE FROM principal_grant_retirements");
    await expect(
      advance({ execSql: db.execSql, heads: [head, head] }),
    ).rejects.toThrow("batch contains multiple heads");
    expect(
      await advance({ execSql: db.execSql, heads, stillCurrent: () => false }),
    ).toBe(false);
    expect(
      await db.execSql("SELECT * FROM access_manifest_checkpoints"),
    ).toHaveLength(1);
  } finally {
    await db.close();
  }
});
