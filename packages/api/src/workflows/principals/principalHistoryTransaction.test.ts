import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalHistoryProgress, users } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import { withBoundedPrincipalHistory } from "./principalHistoryExecution";
import { PrincipalHistoryPreparationRequired } from "./principalHistoryPreparationRequest";
import { PrincipalHistoryPreparationUnavailable } from "./principalHistoryPreparationUnavailable";
import {
  PrincipalHistoryContinuation,
  runPrincipalHistoryTransaction,
} from "./principalHistoryTransaction";

test("continuations roll back operation writes while durable preparation advances", async () => {
  const { head, signer } = await principalHistoryPreparationFixture({
    versions: 65,
    currentArtifacts: true,
  });
  const state = await getCurrentPrincipalState("group", head.principalId, db);
  if (!state) throw new Error("Missing current fixture");
  const user = async () =>
    (await db.select().from(users).where(eq(users.id, signer.userId)))[0];
  const before = await user();
  const marker = crypto.randomUUID();
  const attempt = () =>
    runPrincipalHistoryTransaction(db, async (tx) => {
      await tx
        .update(users)
        .set({ defaultOrganizationId: marker })
        .where(eq(users.id, signer.userId));
      return getVerifiedPrincipalPolicyForStateWithExecutor(tx, state);
    });
  for (const version of [32, 64, 65]) {
    await expect(attempt()).rejects.toBeInstanceOf(
      PrincipalHistoryContinuation,
    );
    expect((await user())?.defaultOrganizationId).toBe(
      before?.defaultOrganizationId,
    );
    const progress = await db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, head.principalId));
    expect(Math.max(...progress.map((row) => row.version))).toBe(version);
  }
  expect((await attempt()).policy.stateHash).toBe(head.stateHash);
  expect((await user())?.defaultOrganizationId).toBe(marker);
}, 30_000);

test("ordinary transaction failures never become preparation continuations", async () => {
  const failure = new Error("authorization changed");
  await expect(
    runPrincipalHistoryTransaction(db, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});

test("a rolled-back successor prepares its committed prefix before rechecking future citations", async () => {
  const { head } = await principalHistoryPreparationFixture({ versions: 3 });
  const successor = { ...head, version: 4, stateHash: "f".repeat(64) };
  await expect(
    runPrincipalHistoryTransaction(db, async () => {
      throw new PrincipalHistoryPreparationRequired({
        head: successor,
        kind: "authority",
        retainedReferences: [successor],
      });
    }),
  ).rejects.toBeInstanceOf(PrincipalHistoryContinuation);
  const progress = await db
    .select()
    .from(principalHistoryProgress)
    .where(eq(principalHistoryProgress.principalId, head.principalId));
  expect(progress.map((row) => row.version)).toEqual([3]);
  expect(progress[0]?.stateHash).toBe(head.stateHash);
  const attempt = runPrincipalHistoryTransaction(db, async () => {
    throw new PrincipalHistoryPreparationRequired({
      head: successor,
      kind: "authority",
      retainedReferences: [successor],
    });
  });
  await expect(attempt).rejects.toBeInstanceOf(
    PrincipalHistoryPreparationUnavailable,
  );
  await expect(attempt).rejects.toMatchObject({
    status: 503,
    message: "Principal history preparation made no progress",
  });
});

test.each(["missing", "changed"] as const)(
  "a %s preparation target returns a declared conflict",
  async (damage) => {
    const { head } = await principalHistoryPreparationFixture({ versions: 1 });
    const requested =
      damage === "missing"
        ? { ...head, principalId: crypto.randomUUID() }
        : { ...head, stateHash: "f".repeat(64) };
    await expect(
      runPrincipalHistoryTransaction(db, async () => {
        throw new PrincipalHistoryPreparationRequired({
          head: requested,
          kind: "policy",
          retainedReferences: [],
        });
      }),
    ).rejects.toMatchObject({ status: 409 });
  },
);

test("completed competing preparation lets the rolled-back operation retry", async () => {
  const { head } = await principalHistoryPreparationFixture({
    versions: 3,
    currentArtifacts: true,
  });
  const state = await getCurrentPrincipalState("group", head.principalId, db);
  if (!state) throw new Error("Missing current fixture");
  const required = await withBoundedPrincipalHistory(() =>
    db.transaction((tx) =>
      getVerifiedPrincipalPolicyForStateWithExecutor(tx, state),
    ),
  ).catch((error: unknown) => error);
  expect(required).toBeInstanceOf(PrincipalHistoryPreparationRequired);
  // Another request completes this exact target after rollback, before this
  // request's queued preparation starts. Its own progress stamp is unchanged.
  const prepared = await preparePrincipalHistory(db, {
    head,
    budget: principalHistoryPreparationBudget(),
  });
  expect(prepared.complete).toBe(true);
  let delayed = true;
  const attempt = () =>
    runPrincipalHistoryTransaction(db, async (tx) => {
      if (delayed) {
        delayed = false;
        throw required;
      }
      return getVerifiedPrincipalPolicyForStateWithExecutor(tx, state);
    });
  await expect(attempt()).rejects.toBeInstanceOf(PrincipalHistoryContinuation);
  expect((await attempt()).policy.stateHash).toBe(head.stateHash);
});
