import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyHistoryReferenceProof,
  type VerifiedPrincipalPolicyHistory,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalHistoryReference } from "../../data/persistence/principalHistoryEvidencePersistence";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

export class PrincipalHistoryEvidenceUnavailableError extends Error {
  constructor(readonly verificationError: KeyingVerificationError) {
    super(verificationError.message);
    this.name = "PrincipalHistoryEvidenceUnavailableError";
  }
}

async function selectReferences(input: {
  readonly options: RecoverPrincipalPolicyHistoryOptions;
  readonly scopeId: string;
  readonly history: VerifiedPrincipalPolicyHistory;
  readonly checkpoint: PrincipalPolicyCheckpoint | null;
}): Promise<VerifiedPrincipalPolicyHistory> {
  const { options, scopeId, history } = input;
  const current = () => !options.signal?.aborted && options.stillCurrent();
  const base = { execSql: options.execSql, scopeId, history };
  const references: PrincipalPolicyHistoryReferenceProof[] = [];
  for (const reference of options.retainedReferences ?? []) {
    assertProjectionVerificationCurrent(current);
    references.push(
      await loadPrincipalHistoryReference({
        ...base,
        version: reference.version,
      }),
    );
  }
  assertProjectionVerificationCurrent(current);
  const checkpointReference = input.checkpoint
    ? await loadPrincipalHistoryReference({
        ...base,
        version: input.checkpoint.version,
      })
    : undefined;
  const selected = await verifyPrincipalPolicyHistoryReferences({
    history,
    references,
    checkpointReference,
  });
  if (!selected.ok) throw selected.error;
  assertProjectionVerificationCurrent(current);
  return selected.value;
}

export async function selectRecoveredPrincipalHistory(
  input: Parameters<typeof selectReferences>[0],
): Promise<VerifiedPrincipalPolicyHistory> {
  let selected: VerifiedPrincipalPolicyHistory;
  try {
    selected = await selectReferences(input);
  } catch (error) {
    if (error instanceof KeyingVerificationError)
      throw new PrincipalHistoryEvidenceUnavailableError(error);
    throw error;
  }
  // First authenticate the stored entry against the private root. Only then
  // compare the caller's citation, so a bad request is not treated as cache loss.
  for (const reference of input.options.retainedReferences ?? []) {
    if (
      !selected.retainedEntries.some(({ state }) =>
        principalHeadMatchesReference(state, reference),
      )
    )
      throw new KeyingVerificationError(
        "object_mismatch",
        "Requested citation does not match the verified principal history",
      );
  }
  return selected;
}
