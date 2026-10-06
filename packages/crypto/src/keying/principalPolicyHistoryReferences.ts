import { normalizePrincipalPolicyStateChainEntry } from "./principalPolicyChainEntry";
import { normalizePrincipalHistoryInput } from "./principalPolicyHistoryChecks";
import { principalHistoryIndexLeaf } from "./principalPolicyHistoryIndex";
import {
  makeVerifiedPrincipalPolicyHistory,
  ownVerifiedPrincipalPolicyHistory,
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type VerifiedPrincipalPolicyHistory,
} from "./principalPolicyHistoryTypes";
import { principalPolicyStateMatchesReference } from "./principalPolicyReference";
import { runVerifier, throwVerification } from "./shared";
import {
  assertTransparencyInclusion,
  normalizeTransparencyInclusionProof,
} from "./transparencyProofs";
import type {
  KeyingVerificationResult,
  PrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
  TransparencyInclusionProof,
} from "./types";

/** Untrusted material to select an entry from a locally verified prefix. */
export interface PrincipalPolicyHistoryReferenceProof {
  readonly reference: ReferencedPrincipalHead;
  readonly entry: PrincipalPolicyStateChainEntry;
  readonly proof: TransparencyInclusionProof;
}

function assertProofBudget(
  references: readonly PrincipalPolicyHistoryReferenceProof[],
): void {
  if (
    !Array.isArray(references) ||
    references.length > PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT
  )
    throwVerification("invalid_shape", "too many principal history proofs");
  const count = references.length;
  for (let index = 0; index < count; index += 1) {
    const path = references[index]?.proof.auditPath;
    if (!Array.isArray(path) || path.length > 53)
      throwVerification(
        "invalid_shape",
        "principal history proof exceeds its budget",
      );
  }
}

/**
 * Select new retained references without replaying signatures. Inclusion is
 * checked against the private root owned by a local verifier, never a peer's
 * claimed root. Each leaf commits to the exact signed entry already accepted.
 * Replaces the retained selection; the current entry is always included.
 * A separate checkpoint proof preserves the full 128-citation selection budget.
 */
export function verifyPrincipalPolicyHistoryReferences(input: {
  readonly history: VerifiedPrincipalPolicyHistory;
  readonly references: readonly PrincipalPolicyHistoryReferenceProof[];
  readonly checkpointReference?:
    | PrincipalPolicyHistoryReferenceProof
    | undefined;
}): Promise<KeyingVerificationResult<VerifiedPrincipalPolicyHistory>> {
  return runVerifier(async () => {
    const history = ownVerifiedPrincipalPolicyHistory(input.history);
    const supplied = input.references;
    const suppliedCheckpoint = input.checkpointReference;
    assertProofBudget(supplied);
    if (suppliedCheckpoint !== undefined)
      assertProofBudget([suppliedCheckpoint]);
    const references = structuredClone(supplied);
    const checkpoint = structuredClone(suppliedCheckpoint);
    assertProofBudget(references);
    const scope = {
      principalId: history.currentEntry.state.principalId,
      principalType: history.currentEntry.state.principalType,
    };
    normalizePrincipalHistoryInput({
      ...scope,
      retainedReferences: references.map((item) => item.reference),
    });
    const selected = [...references];
    if (checkpoint !== undefined) {
      assertProofBudget([checkpoint]);
      normalizePrincipalHistoryInput({
        ...scope,
        retainedReferences: [checkpoint.reference],
      });
      selected.push(checkpoint);
    }
    const entries = new Map<number, PrincipalPolicyStateChainEntry>();
    const treeSize = history.currentEntry.state.version;
    for (const item of selected) {
      const entry = await normalizePrincipalPolicyStateChainEntry(item.entry);
      const proof = normalizeTransparencyInclusionProof(item.proof);
      if (
        !principalPolicyStateMatchesReference(entry.state, item.reference) ||
        entry.state.version > treeSize ||
        proof.leafIndex !== entry.state.version - 1
      )
        throwVerification(
          "object_mismatch",
          "principal history proof reference mismatch",
        );
      await assertTransparencyInclusion({
        leafHash: await principalHistoryIndexLeaf(entry.state),
        checkpoint: {
          logId: "principal-history",
          rootHash: history.indexRootHash,
          treeSize,
        },
        proof,
      });
      entries.set(entry.state.version, entry);
    }
    entries.set(treeSize, history.currentEntry);
    return makeVerifiedPrincipalPolicyHistory({
      ...history,
      retainedEntries: [...entries.values()].sort(
        (left, right) => left.state.version - right.state.version,
      ),
    });
  });
}
