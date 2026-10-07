import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import {
  PrincipalHistoryContinuation,
  runPrincipalHistoryTransaction,
} from "./principalHistoryTransaction";
import { buildPrincipalPolicySnapshotPage } from "./principalPolicySnapshotPage";

test("public history pages require no live group, payload or envelopes and verify exact returned bytes", async () => {
  const fixture = await principalHistoryPreparationFixture({ versions: 66 });
  const head = await getCurrentPrincipalState(
    "group",
    fixture.head.principalId,
    db,
  );
  if (!head) throw new Error("Missing public history");
  const read = async (afterVersion: number) => {
    for (let i = 0; i < 10; i += 1) {
      try {
        return await runPrincipalHistoryTransaction(db, (tx) =>
          buildPrincipalPolicySnapshotPage(tx, head, afterVersion),
        );
      } catch (error) {
        if (!(error instanceof PrincipalHistoryContinuation)) throw error;
      }
    }
    throw new Error("History preparation did not finish");
  };
  for (const after of [0, 32, 64, 65]) {
    const page = await read(after);
    expect(page.currentState.stateHash).toBe(head.stateHash);
    expect(page.previousStates.map((entry) => entry.state.version)).toEqual(
      Array.from({ length: Math.min(32, 65 - after) }, (_, i) => after + i + 1),
    );
    expect(page).not.toHaveProperty("currentPayload");
    expect(page).not.toHaveProperty("currentMemberEnvelopes");
  }
  for (const cursor of [-1, 0.5, 66, NaN])
    await expect(read(cursor)).rejects.toMatchObject({ status: 400 });
  const entry = fixture.entries[32];
  if (!entry) throw new Error("Missing fixture entry");
  const target = and(
    eq(principalStates.principalId, head.principalId),
    eq(principalStates.version, 33),
  );
  try {
    await db
      .update(principalStates)
      .set({ signature: head.signature })
      .where(target);
    await expect(read(32)).rejects.toThrow("proof root does not match");
  } finally {
    await db
      .update(principalStates)
      .set({ signature: entry.state.signature })
      .where(target);
  }
}, 15_000);
