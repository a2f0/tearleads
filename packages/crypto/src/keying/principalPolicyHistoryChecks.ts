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
} from "./types";

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
  if (requested.length > PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT)
    throwVerification(
      "invalid_shape",
      "too many retained principal references",
    );
  const references = requested.map(normalizeReferencedPrincipalHead);
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
