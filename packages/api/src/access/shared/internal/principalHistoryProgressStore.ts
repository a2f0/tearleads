import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type PrincipalHistoryVerificationKind,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { and, desc, eq, lte } from "drizzle-orm";

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

/** Remove newest hints first so the next resume candidate advances each round. */
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
    .orderBy(desc(principalHistoryProgress.version))
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

export async function upsertPrincipalHistoryProgress(
  executor: DatabaseSession,
  input: PrincipalHistoryProgressScope &
    ReferencedPrincipalHead & {
      readonly progress: string;
    },
): Promise<void> {
  await executor
    .insert(principalHistoryProgress)
    .values(input)
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
        protectionId: input.protectionId,
        stateHash: input.stateHash,
        keyEpoch: input.keyEpoch,
        keyFingerprint: input.keyFingerprint,
        progress: input.progress,
        updatedAt: new Date(),
      },
    });
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
