import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  type VerifiedPrincipalPolicyHistory,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { loadPrincipalHistoryReferences } from "../../../data/persistence/principalHistory/principalHistoryEvidencePersistence";
import { principalHeadMatchesReference } from "../../../data/principals/organizationAuthorityDescriptor";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

export interface PrincipalHistorySelectionOptions
  extends RecoverPrincipalPolicyHistoryOptions {
  /** Internal page selection by version; every selected row still needs a private-root proof. */
  readonly retainedVersions?: readonly number[] | undefined;
}

export class PrincipalHistoryEvidenceUnavailableError extends Error {
  constructor(readonly verificationError: KeyingVerificationError) {
    super(verificationError.message);
    this.name = "PrincipalHistoryEvidenceUnavailableError";
  }
}

async function selectReferences(input: {
  readonly options: PrincipalHistorySelectionOptions;
  readonly scopeId: string;
  readonly history: VerifiedPrincipalPolicyHistory;
  readonly checkpoint: PrincipalPolicyCheckpoint | null;
}): Promise<VerifiedPrincipalPolicyHistory> {
  const { options, scopeId, history } = input;
  const current = () => !options.signal?.aborted && options.stillCurrent();
  const versions = (options.retainedReferences ?? []).map(
    (reference) => reference.version,
  );
  const cited = new Set(versions);
  for (const version of options.retainedVersions ?? []) {
    if (cited.has(version)) continue;
    cited.add(version);
    versions.push(version);
  }
  assertProjectionVerificationCurrent(current);
  const loaded = await loadPrincipalHistoryReferences({
    execSql: options.execSql,
    scopeId,
    history,
    versions: input.checkpoint
      ? [...versions, input.checkpoint.version]
      : versions,
  });
  assertProjectionVerificationCurrent(current);
  const references = loaded.slice(0, versions.length);
  const checkpointReference = input.checkpoint
    ? loaded[versions.length]
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
