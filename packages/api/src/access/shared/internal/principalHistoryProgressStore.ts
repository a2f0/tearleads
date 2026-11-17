import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type PrincipalHistoryVerificationKind,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import {
  compareCanonicalStrings,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";

export interface PrincipalHistoryProgressScope {
  readonly principalType: ReferencedPrincipalHead["principalType"];
  readonly principalId: string;
  readonly verificationKind: PrincipalHistoryVerificationKind;
  readonly inputHash: string;
  readonly protectionId: string;
}

function scopeFilter(input: PrincipalHistoryProgressScope) {
  return and(
    eq(principalHistoryProgress.principalType, input.principalType),
    eq(principalHistoryProgress.principalId, input.principalId),
    eq(principalHistoryProgress.verificationKind, input.verificationKind),
    eq(principalHistoryProgress.inputHash, input.inputHash),
    eq(principalHistoryProgress.protectionId, input.protectionId),
  );
}

/** Drain the oldest hints so a damaged subtree eventually rebuilds from genesis. */
export async function selectPrincipalHistoryProgressForDiscard(
  executor: DatabaseSession,
  input: PrincipalHistoryProgressScope & { readonly throughVersion: number },
) {
  return executor
    .select({
      id: principalHistoryProgress.id,
      progress: principalHistoryProgress.progress,
    })
    .from(principalHistoryProgress)
    .where(
      and(
        scopeFilter(input),
        lte(principalHistoryProgress.version, input.throughVersion),
      ),
    )
    .orderBy(asc(principalHistoryProgress.version))
    .limit(32);
}

/** Locator columns are untrusted; authenticate the saved verifier before use. */
export async function selectPrincipalHistoryProgress(
  executor: DatabaseSession,
  input: PrincipalHistoryProgressScope & { readonly throughVersion: number },
) {
  const [row] = await executor
    .select()
    .from(principalHistoryProgress)
    .where(
      and(
        scopeFilter(input),
        lte(principalHistoryProgress.version, input.throughVersion),
      ),
    )
    .orderBy(desc(principalHistoryProgress.version))
    .limit(1);
  return row ?? null;
}

/** A bounded marker for progress while draining unusable cached prefixes. */
export async function selectOldestPrincipalHistoryProgressId(
  executor: DatabaseSession,
  input: PrincipalHistoryProgressScope & { readonly throughVersion: number },
): Promise<string | null> {
  const [row] = await executor
    .select({ id: principalHistoryProgress.id })
    .from(principalHistoryProgress)
    .where(
      and(
        scopeFilter(input),
        lte(principalHistoryProgress.version, input.throughVersion),
      ),
    )
    .orderBy(asc(principalHistoryProgress.version))
    .limit(1);
  return row?.id ?? null;
}

type PrincipalHistoryProgressRow = PrincipalHistoryProgressScope &
  ReferencedPrincipalHead & {
    readonly id?: string;
    readonly progress: string;
    readonly updatedAt?: Date;
  };

function progressRowOrder(row: PrincipalHistoryProgressRow): string {
  return JSON.stringify([
    row.principalType,
    row.principalId,
    row.verificationKind,
    row.inputHash,
    row.protectionId,
  ]);
}

/**
 * Upsert progress rows, at most 100 per statement. Each row has a distinct
 * key, and rows are written in key order so concurrent batches lock shared
 * keys in the same order.
 */
export async function upsertPrincipalHistoryProgress(
  executor: DatabaseSession,
  rows: readonly PrincipalHistoryProgressRow[],
): Promise<void> {
  const sorted = [...rows].sort(
    (left, right) =>
      compareCanonicalStrings(
        progressRowOrder(left),
        progressRowOrder(right),
      ) || left.version - right.version,
  );
  const updatedAt = new Date();
  for (let start = 0; start < sorted.length; start += 100) {
    await executor
      .insert(principalHistoryProgress)
      .values(sorted.slice(start, start + 100))
      .onConflictDoUpdate({
        target: [
          principalHistoryProgress.principalType,
          principalHistoryProgress.principalId,
          principalHistoryProgress.verificationKind,
          principalHistoryProgress.inputHash,
          principalHistoryProgress.protectionId,
          principalHistoryProgress.version,
        ],
        set: {
          protectionId: sql`excluded.protection_id`,
          stateHash: sql`excluded.state_hash`,
          keyEpoch: sql`excluded.key_epoch`,
          keyFingerprint: sql`excluded.key_fingerprint`,
          progress: sql`excluded.progress`,
          updatedAt,
        },
      });
  }
}

/** Remove only the invalid hint observed, preserving a concurrent replacement. */
export async function discardPrincipalHistoryProgress(
  executor: DatabaseSession,
  input: { readonly id: string; readonly progress: string },
): Promise<void> {
  await executor
    .delete(principalHistoryProgress)
    .where(
      and(
        eq(principalHistoryProgress.id, input.id),
        eq(principalHistoryProgress.progress, input.progress),
      ),
    );
}
