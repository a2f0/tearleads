import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalHistoryProgress,
  principalMembershipProjection,
  principalStates,
  users,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import { principalHistoryProtection } from "./principalHistoryProtection";

function oneEntry() {
  return { ...principalHistoryPreparationBudget(), remainingEntries: 1 };
}

test("stored preparation resumes in bounded steps and retains requested ancestry", async () => {
  const { entries, head } = await principalHistoryPreparationFixture();
  const retained = entries[1]?.state;
  if (!retained) throw new Error("Missing reference fixture");
  for (let version = 1; version <= head.version; version++) {
    const budget = oneEntry();
    const result = await preparePrincipalHistory(db, {
      head,
      budget,
      retainedReferences: [retained],
    });
    expect(budget.acceptedEntries).toBe(1);
    expect(result.complete).toBe(version === head.version);
    const rows = await db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, head.principalId));
    expect(rows.map((row) => row.version).sort((a, b) => a - b)).toEqual(
      Array.from({ length: version }, (_, i) => i + 1),
    );
    if (result.complete)
      expect(
        result.history.retainedEntries.map((entry) => entry.state.version),
      ).toEqual([2, 4]);
  }
  const budget = oneEntry();
  const ready = await preparePrincipalHistory(db, {
    head,
    budget,
    retainedReferences: [retained],
  });
  expect(ready.complete).toBe(true);
  expect(budget.acceptedEntries).toBe(0);
});

test("missing progress re-verifies signatures instead of trusting the head", async () => {
  const { head, entries } = await principalHistoryPreparationFixture({
    versions: 2,
  });
  expect(
    (
      await preparePrincipalHistory(db, {
        head,
        budget: principalHistoryPreparationBudget(),
      })
    ).complete,
  ).toBe(true);
  await db
    .delete(principalHistoryProgress)
    .where(eq(principalHistoryProgress.principalId, head.principalId));
  await db
    .update(principalStates)
    .set({ signature: entries[1]?.state.signature })
    .where(
      and(
        eq(principalStates.principalId, head.principalId),
        eq(principalStates.version, 1),
      ),
    );
  await expect(
    preparePrincipalHistory(db, { head, budget: oneEntry() }),
  ).rejects.toThrow("integrity verification");
});

test("a saved prefix still checks its last stored projection before extension", async () => {
  const { head, entries } = await principalHistoryPreparationFixture({
    versions: 2,
  });
  expect(
    (await preparePrincipalHistory(db, { head, budget: oneEntry() })).complete,
  ).toBe(false);
  await db
    .update(principalMembershipProjection)
    .set({ role: "member" })
    .where(
      and(
        eq(principalMembershipProjection.principalId, head.principalId),
        eq(
          principalMembershipProjection.stateHash,
          entries[0]?.state.stateHash ?? "missing",
        ),
      ),
    );
  await expect(
    preparePrincipalHistory(db, { head, budget: oneEntry() }),
  ).rejects.toThrow("saved principal history differs");
});

test("a ready prefix still validates its current signer identity", async () => {
  const { head, signer } = await principalHistoryPreparationFixture({
    versions: 1,
  });
  expect(
    (await preparePrincipalHistory(db, { head, budget: oneEntry() })).complete,
  ).toBe(true);
  const other = await principalHistoryPreparationFixture({ versions: 1 });
  const [replacement] = await db
    .select()
    .from(users)
    .where(eq(users.id, other.signer.userId));
  if (!replacement) throw new Error("Missing alternate signer");
  await db
    .update(users)
    .set({ signingPublicKey: replacement.signingPublicKey })
    .where(eq(users.id, signer.userId));
  await expect(
    preparePrincipalHistory(db, { head, budget: oneEntry() }),
  ).rejects.toThrow("signer key fingerprint does not match");
});

test("a saved predecessor does not hide replaced signature bytes", async () => {
  const { head, entries } = await principalHistoryPreparationFixture({
    versions: 2,
  });
  const first = entries[0];
  if (!first) throw new Error("Missing predecessor");
  expect(
    (await preparePrincipalHistory(db, { head, budget: oneEntry() })).complete,
  ).toBe(false);
  await db
    .update(principalStates)
    .set({ signature: head.signature })
    .where(
      and(
        eq(principalStates.principalId, head.principalId),
        eq(principalStates.version, first.state.version),
      ),
    );
  await expect(
    preparePrincipalHistory(db, { head, budget: oneEntry() }),
  ).rejects.toThrow("saved principal history differs");
});

test("rotating the local key starts bounded re-verification and recovers", async () => {
  const secretName = "DOCUMENT_SYNC_CURSOR_HMAC_KEY";
  const previous = process.env[secretName];
  try {
    process.env[secretName] = "a".repeat(32);
    const { head } = await principalHistoryPreparationFixture({ versions: 2 });
    expect(
      (
        await preparePrincipalHistory(db, {
          head,
          budget: principalHistoryPreparationBudget(),
        })
      ).complete,
    ).toBe(true);
    process.env[secretName] = "b".repeat(32);
    const budget = oneEntry();
    expect((await preparePrincipalHistory(db, { head, budget })).complete).toBe(
      false,
    );
    expect(budget.acceptedEntries).toBe(1);
    expect(
      (await preparePrincipalHistory(db, { head, budget: oneEntry() }))
        .complete,
    ).toBe(true);
  } finally {
    if (previous === undefined) delete process.env[secretName];
    else process.env[secretName] = previous;
  }
});

test("untrusted locator columns cannot advance a valid saved prefix", async () => {
  const { head } = await principalHistoryPreparationFixture({ versions: 2 });
  await preparePrincipalHistory(db, {
    head,
    budget: principalHistoryPreparationBudget(),
  });
  await db
    .update(principalHistoryProgress)
    .set({ stateHash: "f".repeat(64) })
    .where(eq(principalHistoryProgress.principalId, head.principalId));
  expect(
    (await preparePrincipalHistory(db, { head, budget: oneEntry() })).complete,
  ).toBe(false);
  expect(
    await db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, head.principalId)),
  ).toHaveLength(0);
  expect(
    (
      await preparePrincipalHistory(db, {
        head,
        budget: principalHistoryPreparationBudget(),
      })
    ).complete,
  ).toBe(true);
});

test("ordinary policy progress cannot impersonate all-admin history", async () => {
  const { head } = await principalHistoryPreparationFixture({
    versions: 2,
    initiallyOrdinaryMember: true,
  });
  expect(
    (
      await preparePrincipalHistory(db, {
        head,
        budget: principalHistoryPreparationBudget(),
      })
    ).complete,
  ).toBe(true);
  const [saved] = await db
    .select()
    .from(principalHistoryProgress)
    .where(eq(principalHistoryProgress.principalId, head.principalId));
  if (!saved) throw new Error("Missing saved progress");
  const authority = principalHistoryProtection(
    { principalType: head.principalType, principalId: head.principalId },
    "authority",
  );
  try {
    await db
      .insert(principalHistoryProgress)
      .values({ ...saved, ...authority.scope, id: crypto.randomUUID() });
  } finally {
    authority.protection.localKey.fill(0);
  }
  expect(
    (
      await preparePrincipalHistory(db, {
        head,
        kind: "authority",
        budget: oneEntry(),
      })
    ).complete,
  ).toBe(false);
  await expect(
    preparePrincipalHistory(db, {
      head,
      kind: "authority",
      budget: oneEntry(),
    }),
  ).rejects.toThrow("non-admin projection");
});

test("a dependent policy cannot starve authority preparation with a tiny budget", async () => {
  const admin = await principalHistoryPreparationFixture({ versions: 3 });
  const managed = await principalHistoryPreparationFixture({
    versions: 1,
    signer: admin.signer,
    externalAuthority: { ...admin.head, principalType: "group" },
  });
  let completed = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await preparePrincipalHistory(db, {
      head: managed.head,
      budget: { ...oneEntry(), remainingBytes: 1, deadline: 0 },
    });
    if (result.complete) {
      completed = true;
      break;
    }
  }
  expect(completed).toBe(true);
});

test("preparation hints roll back with their transaction", async () => {
  const { head } = await principalHistoryPreparationFixture({ versions: 1 });
  await expect(
    db.transaction(async (tx) => {
      expect(
        (await preparePrincipalHistory(tx, { head, budget: oneEntry() }))
          .complete,
      ).toBe(true);
      throw new Error("rollback the prepared prefix");
    }),
  ).rejects.toThrow("rollback the prepared prefix");
  expect(
    await db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, head.principalId)),
  ).toHaveLength(0);
  const budget = oneEntry();
  expect((await preparePrincipalHistory(db, { head, budget })).complete).toBe(
    true,
  );
  expect(budget.acceptedEntries).toBe(1);
});
