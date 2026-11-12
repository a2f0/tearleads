import { expect, test } from "bun:test";
import { signedRecoveryHistory } from "../../../../test/helpers/principalHistoryRecovery";
import { retentionBatchFixture } from "../../../../test/helpers/principalRetentionBatch";

// Counts are executor calls against real SQLite, including BEGIN/COMMIT;
// fixture setup and result reads are deliberately outside the measured pass.
test("incomplete retention batches shared-root decrements without a steady-state penalty", async () => {
  const counts: number[] = [];
  for (const obsolete of [0, 1, 16]) {
    const f = await retentionBatchFixture("incomplete", obsolete);
    try {
      const started = performance.now();
      await f.run();
      const measured = [...f.statements];
      counts.push(measured.length);
      console.info(
        "retention-measurement",
        JSON.stringify({
          pass: "incomplete",
          obsolete,
          calls: measured.length,
          maxBinds: Math.max(...measured.map((entry) => entry.binds)),
          elapsedMs: performance.now() - started,
        }),
      );
      expect(measured[0]?.sql).toBe("BEGIN IMMEDIATE");
      expect(measured.at(-1)?.sql).toBe("COMMIT");
      expect(measured.every((entry) => entry.binds <= 999)).toBe(true);
      const after = await f.snapshot();
      expect(after.stages.map((row) => row.id)).toEqual(
        f.rows.slice(obsolete).map((row) => row.id),
      );
      expect(after.nodes[0]?.referenceCount).toBe(f.retained + 1);
      expect(after.archives).toEqual([]);
    } finally {
      f.close();
    }
  }
  expect(counts).toEqual([3, 5, 5]);
});

test.each(["completed", "unpublished"] as const)(
  "%s retention batches roots, archives and deletes",
  async (pass) => {
    const { bundle } = await signedRecoveryHistory(1);
    const counts: number[] = [];
    for (const obsolete of [0, 1, 16]) {
      const f = await retentionBatchFixture(
        pass,
        obsolete,
        JSON.stringify(bundle),
      );
      try {
        const started = performance.now();
        await f.run();
        const measured = [...f.statements];
        counts.push(measured.length);
        console.info(
          "retention-measurement",
          JSON.stringify({
            pass,
            obsolete,
            calls: measured.length,
            maxBinds: Math.max(...measured.map((entry) => entry.binds)),
            elapsedMs: performance.now() - started,
          }),
        );
        expect(measured[0]?.sql).toBe("BEGIN IMMEDIATE");
        expect(measured.at(-1)?.sql).toBe("COMMIT");
        expect(measured.every((entry) => entry.binds <= 999)).toBe(true);
        const after = await f.snapshot();
        expect(after.stages.map((row) => row.id)).toEqual(
          f.rows.slice(obsolete).map((row) => row.id),
        );
        expect(after.nodes[0]?.referenceCount).toBe(f.retained + 1);
        expect(after.archives).toEqual(
          obsolete === 0
            ? []
            : [
                {
                  organizationId: f.scope.organizationId,
                  principalId: bundle.currentState.principalId,
                  principalType: bundle.currentState.principalType,
                  keyFingerprint: bundle.currentState.keyFingerprint,
                  version: 1,
                  envelopesJson: JSON.stringify(bundle.currentMemberEnvelopes),
                },
              ],
        );
      } finally {
        f.close();
      }
    }
    expect(counts).toEqual(pass === "completed" ? [3, 6, 6] : [4, 7, 7]);
  },
);
