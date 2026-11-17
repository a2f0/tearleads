import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { principalHistoryProgress } from "@tearleads/api-shared/schema";
import { asc, eq } from "drizzle-orm";
import { upsertPrincipalHistoryProgress } from "./principalHistoryProgress";

function progressRows(principalId: string, label: string) {
  // Out of key order, across two verification kinds.
  return [3, 1, 2].map((version) => ({
    principalType: "group" as const,
    principalId,
    verificationKind:
      version === 2 ? ("authority" as const) : ("policy" as const),
    inputHash: "input",
    protectionId: "protection",
    version,
    stateHash: `${label}-state-${version}`,
    keyEpoch: version,
    keyFingerprint: `${label}-key-${version}`,
    progress: `${label}-progress-${version}`,
  }));
}

async function storedRows(principalId: string) {
  return db
    .select()
    .from(principalHistoryProgress)
    .where(eq(principalHistoryProgress.principalId, principalId))
    .orderBy(asc(principalHistoryProgress.version));
}

test("progress rows are upserted in one statement, each from its own values", async () => {
  const principalId = crypto.randomUUID();
  const counter = { statements: 0 };
  await withDatabaseStatementCounter(counter, () =>
    upsertPrincipalHistoryProgress(db, progressRows(principalId, "first")),
  );
  expect(counter.statements).toBe(1);
  const inserted = await storedRows(principalId);
  expect(inserted.map((row) => row.progress)).toEqual([
    "first-progress-1",
    "first-progress-2",
    "first-progress-3",
  ]);

  counter.statements = 0;
  await withDatabaseStatementCounter(counter, () =>
    upsertPrincipalHistoryProgress(db, progressRows(principalId, "second")),
  );
  expect(counter.statements).toBe(1);
  const updated = await storedRows(principalId);
  // A conflict keeps the row and takes every replaced column from its own
  // proposed row, not from another row of the batch.
  expect(updated.map((row) => row.id)).toEqual(inserted.map((row) => row.id));
  expect(
    updated.map(
      ({ keyEpoch, keyFingerprint, progress, stateHash, version }) => ({
        keyEpoch,
        keyFingerprint,
        progress,
        stateHash,
        version,
      }),
    ),
  ).toEqual(
    [1, 2, 3].map((version) => ({
      keyEpoch: version,
      keyFingerprint: `second-key-${version}`,
      progress: `second-progress-${version}`,
      stateHash: `second-state-${version}`,
      version,
    })),
  );

  counter.statements = 0;
  await withDatabaseStatementCounter(counter, () =>
    upsertPrincipalHistoryProgress(db, []),
  );
  expect(counter.statements).toBe(0);
});
