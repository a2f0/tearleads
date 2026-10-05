import { normalizeReferencedPrincipalHead } from "./accessEvent";
import {
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type PrincipalPolicyHistoryInput,
} from "./principalPolicyHistoryTypes";
import {
  normalizeManagedPrincipalKind,
  readString,
  throwVerification,
} from "./shared";
import type {
  PrincipalPolicyCheckpoint,
  PrincipalPolicySignedState,
  ReferencedPrincipalHead,
} from "./types";

function assertReferenceBudget(count: number): void {
  if (count > PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT)
    throwVerification(
      "invalid_shape",
      "too many retained principal references",
    );
}

function normalizeReferences(
  requested: readonly ReferencedPrincipalHead[],
): ReferencedPrincipalHead[] {
  assertReferenceBudget(requested.length);
  const references: ReferencedPrincipalHead[] = [];
  for (const reference of requested) {
    // Bind the limit to consumed entries even if the caller supplies a custom
    // iterator. Use our own normalizer and array rather than a caller's map.
    assertReferenceBudget(references.length + 1);
    references.push(normalizeReferencedPrincipalHead(reference));
  }
  return references;
}

export function normalizePrincipalHistoryInput(
  input: PrincipalPolicyHistoryInput,
) {
  const principalId = readString(
    { principalId: input.principalId },
    "principalId",
    "principal history",
  );
  const principalType = normalizeManagedPrincipalKind(
    input.principalType,
    "principal history",
  );
  const checkpoint = structuredClone(input.localCheckpoint ?? null);
  const requested = input.retainedReferences ?? [];
  const references = normalizeReferences(requested);
  if (
    new Set(references.map((reference) => reference.version)).size !==
    references.length
  )
    throwVerification(
      "duplicate_entry",
      "principal history references contain a duplicate version",
    );
  if (
    references.some(
      (reference) =>
        reference.principalId !== principalId ||
        reference.principalType !== principalType,
    ) ||
    (checkpoint &&
      (checkpoint.principalId !== principalId ||
        checkpoint.principalType !== principalType))
  )
    throwVerification("object_mismatch", "principal history scope mismatch");
  if (
    checkpoint &&
    (!Number.isSafeInteger(checkpoint.version) ||
      checkpoint.version < 1 ||
      !/^[0-9a-f]{64}$/.test(checkpoint.stateHash))
  )
    throwVerification("invalid_shape", "invalid principal history checkpoint");
  return { principalId, principalType, checkpoint, references };
}

export function verifyPrincipalHistoryCheckpoint(
  state: PrincipalPolicySignedState,
  checkpoint: PrincipalPolicyCheckpoint | null,
  checkpointHash: string | undefined,
): void {
  if (!checkpoint) return;
  if (state.version < checkpoint.version)
    throwVerification(
      "rollback",
      "principal history is older than the local checkpoint",
    );
  if (
    state.version === checkpoint.version &&
    state.stateHash !== checkpoint.stateHash
  )
    throwVerification(
      "equivocation",
      "principal history conflicts with the local checkpoint",
    );
  if (checkpointHash !== checkpoint.stateHash)
    throwVerification(
      "stale_predecessor",
      "principal history does not extend the local checkpoint",
    );
}
