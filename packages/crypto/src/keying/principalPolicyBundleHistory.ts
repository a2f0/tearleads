import { normalizePrincipalPolicyStateChainEntry } from "./principalPolicyChainEntry";
import { verifyPrincipalPolicyCurrent } from "./principalPolicyCurrent";
import {
  appendPrincipalHistoryIndex,
  type PrincipalHistoryIndexFrontier,
} from "./principalPolicyHistoryIndex";
import {
  ownVerifiedPrincipalPolicyHistory,
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type VerifiedPrincipalPolicyHistory,
} from "./principalPolicyHistoryTypes";
import { makeVerifiedPrincipalPolicy } from "./principalPolicyTypes";
import { runVerifier, throwVerification } from "./shared";
import type {
  KeyingVerificationResult,
  PrincipalPolicyBundle,
  PrincipalPolicySignedState,
  VerifiedPrincipalPolicy,
} from "./types";

/** Check a complete bundle against locally verified history without replaying signatures. */
export function verifyPrincipalPolicyBundleAgainstHistory(input: {
  readonly bundle: PrincipalPolicyBundle;
  readonly history: VerifiedPrincipalPolicyHistory;
}): Promise<KeyingVerificationResult<VerifiedPrincipalPolicy>> {
  return runVerifier(async () => {
    const bundle = structuredClone(input.bundle);
    const capability = input.history;
    const history = ownVerifiedPrincipalPolicyHistory(capability);
    if (
      !Array.isArray(bundle.previousStates) ||
      bundle.previousStates.length !== history.currentEntry.state.version - 1
    )
      throwVerification(
        "missing_dependency",
        "principal bundle history is incomplete",
      );
    const verified = await verifyPrincipalPolicyCurrent({
      current: {
        currentState: bundle.currentState,
        currentProjection: bundle.currentProjection,
        currentGrants: bundle.currentGrants,
        currentPayload: bundle.currentPayload,
        currentMemberEnvelopes: bundle.currentMemberEnvelopes,
      },
      history: capability,
    });
    if (!verified.ok) throw verified.error;
    const current = verified.value;
    const entries: Array<
      NonNullable<VerifiedPrincipalPolicy["history"]>[number]
    > = [];
    let frontier: PrincipalHistoryIndexFrontier = [];
    let rootHash: string | null = null;
    let batch: PrincipalPolicySignedState[] = [];
    for (let index = 0; index < current.version; index += 1) {
      const entry = await normalizePrincipalPolicyStateChainEntry(
        index === current.version - 1
          ? {
              state: current.state,
              projection: current.projection,
              grants: current.grants,
            }
          : bundle.previousStates[index],
      );
      if (
        entry.state.version !== index + 1 ||
        entry.state.principalType !== current.principalType ||
        entry.state.principalId !== current.principalId
      )
        throwVerification(
          "object_mismatch",
          "principal bundle history scope or order differs",
        );
      entries.push({
        state: entry.state,
        projection: [...entry.projection],
        grants: [...entry.grants],
      });
      batch.push(entry.state);
      if (
        batch.length === PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT ||
        index === current.version - 1
      ) {
        const appended = await appendPrincipalHistoryIndex(frontier, batch);
        frontier = appended.frontier;
        rootHash = appended.rootHash;
        batch = [];
      }
    }
    if (rootHash !== history.indexRootHash)
      throwVerification(
        "hash_mismatch",
        "principal bundle history differs from verified history",
      );
    return makeVerifiedPrincipalPolicy({
      principalType: current.principalType,
      principalId: current.principalId,
      version: current.version,
      keyEpoch: current.keyEpoch,
      stateHash: current.stateHash,
      state: current.state,
      projection: current.projection,
      grants: current.grants,
      history: entries,
      checkpoint: current.checkpoint,
    });
  });
}
