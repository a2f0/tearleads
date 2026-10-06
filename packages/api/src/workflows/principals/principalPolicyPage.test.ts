import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { isPrincipalPolicyPageResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { PrincipalHistoryContinuation } from "./principalHistoryTransaction";
import { runReadCurrentPrincipalPolicyWorkflow } from "./readCurrentPrincipalPolicy";

type ReadInput = Parameters<typeof runReadCurrentPrincipalPolicyWorkflow>[1];

async function readPrepared(input: ReadInput) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await runReadCurrentPrincipalPolicyWorkflow(db, input);
    } catch (error) {
      if (!(error instanceof PrincipalHistoryContinuation)) throw error;
    }
  }
  throw new Error("Fixture did not finish bounded history preparation");
}

test("principal reads return contiguous bounded pages of a verified pinned history", async () => {
  const { head, signer } = await principalHistoryPreparationFixture({
    versions: 66,
    currentArtifacts: true,
  });
  const input = {
    principalType: head.principalType,
    principalId: head.principalId,
    requesterUserId: signer.userId,
  };
  const first = await readPrepared(input);
  expect(isPrincipalPolicyPageResponse(first)).toBe(true);
  expect(first.currentState.stateHash).toBe(head.stateHash);
  expect(first.previousStates.map(({ state }) => state.version)).toEqual(
    Array.from({ length: 32 }, (_, index) => index + 1),
  );
  expect(first.historyPage).toEqual({ afterVersion: 0, nextAfterVersion: 32 });
  const second = await readPrepared({
    ...input,
    stateHash: head.stateHash,
    afterVersion: 32,
  });
  expect(second.previousStates.map(({ state }) => state.version)).toEqual(
    Array.from({ length: 32 }, (_, index) => index + 33),
  );
  expect(second.historyPage).toEqual({
    afterVersion: 32,
    nextAfterVersion: 64,
  });
  const last = await readPrepared({
    ...input,
    stateHash: head.stateHash,
    afterVersion: 64,
  });
  expect(last.previousStates.map(({ state }) => state.version)).toEqual([65]);
  expect(last.historyPage).toEqual({
    afterVersion: 64,
    nextAfterVersion: null,
  });
  const empty = await readPrepared({
    ...input,
    stateHash: head.stateHash,
    afterVersion: 65,
  });
  expect(empty.previousStates).toEqual([]);
  expect(empty.historyPage.nextAfterVersion).toBeNull();
  for (const query of [
    { afterVersion: 32 },
    { stateHash: head.stateHash, afterVersion: 66 },
    { stateHash: head.stateHash, afterVersion: -1 },
  ]) {
    await expect(readPrepared({ ...input, ...query })).rejects.toMatchObject({
      status: 400,
    });
  }
  await expect(
    readPrepared({ ...input, stateHash: "0".repeat(64) }),
  ).rejects.toMatchObject({ status: 409 });

  // A cached authenticated prefix cannot bless replacement signature bytes.
  await db
    .update(principalStates)
    .set({ signature: head.signature })
    .where(
      and(
        eq(principalStates.principalId, head.principalId),
        eq(principalStates.version, 33),
      ),
    );
  await expect(
    readPrepared({ ...input, stateHash: head.stateHash, afterVersion: 32 }),
  ).rejects.toThrow("proof root does not match");
}, 15_000);

test("later pages recheck live access rather than borrowing the pinned policy's membership", async () => {
  const { head, signer } = await principalHistoryPreparationFixture({
    versions: 34,
    currentArtifacts: true,
  });
  const input = {
    principalType: head.principalType,
    principalId: head.principalId,
    requesterUserId: signer.userId,
  };
  const first = await readPrepared(input);
  expect(first.historyPage.nextAfterVersion).toBe(32);
  await db
    .delete(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalId, head.principalId),
        eq(principalMembershipProjection.stateHash, head.stateHash),
      ),
    );
  await expect(
    readPrepared({ ...input, stateHash: head.stateHash, afterVersion: 32 }),
  ).rejects.toMatchObject({ status: 403 });
  const attacker = crypto.randomUUID();
  await db.insert(principalMembershipProjection).values({
    principalType: head.principalType,
    principalId: head.principalId,
    stateHash: head.stateHash,
    userId: attacker,
    role: "admin",
  });
  await expect(
    readPrepared({
      ...input,
      requesterUserId: attacker,
      stateHash: head.stateHash,
      afterVersion: 32,
    }),
  ).rejects.toThrow();
}, 15_000);
