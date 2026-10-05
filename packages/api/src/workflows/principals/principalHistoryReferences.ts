import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalHistoryVerificationKind } from "@tearleads/api-shared/schema";
import {
  createPrincipalHistoryIndexProof,
  createPrincipalPolicyHistoryVerifier,
  KeyingVerificationError,
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type PrincipalPolicyHistoryReferenceProof,
  type ReferencedPrincipalHead,
  type TransparencyInclusionProof,
  type VerifiedPrincipalPolicyHistory,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { readBufferedPrincipalHistoryNode } from "./principalHistoryCache";
import {
  principalHistoryError,
  principalHistoryHead,
  readPrincipalHistoryEntry,
} from "./principalHistoryRecords";
import { PrincipalPolicyReferenceError } from "./shared";

/** Validate the selection separately from the stable empty-selection prefix. */
export function requestedPrincipalHistoryReferences(
  head: ReferencedPrincipalHead,
  references: readonly ReferencedPrincipalHead[],
): readonly ReferencedPrincipalHead[] {
  try {
    if (references.length > PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT)
      throw new Error("too many requested principal references");
    const owned = references.map(principalHistoryHead);
    // Reuse the crypto input contract before reading any selected entries.
    createPrincipalPolicyHistoryVerifier({
      principalId: head.principalId,
      principalType: head.principalType,
      retainedReferences: owned,
    });
    if (owned.some((reference) => reference.version > head.version))
      throw new Error(
        "requested principal reference is newer than the pinned head",
      );
    return owned;
  } catch {
    throw new PrincipalPolicyReferenceError();
  }
}

export async function selectStoredPrincipalHistoryReferences(
  executor: DatabaseSession,
  history: VerifiedPrincipalPolicyHistory,
  requested: readonly ReferencedPrincipalHead[],
  kind: PrincipalHistoryVerificationKind,
): Promise<VerifiedPrincipalPolicyHistory | null> {
  if (requested.length === 0) return history;
  const references: PrincipalPolicyHistoryReferenceProof[] = [];
  for (const reference of requested) {
    const entry = await readPrincipalHistoryEntry(
      executor,
      history.currentEntry.state,
      reference.version,
      kind,
    );
    let proof: TransparencyInclusionProof;
    try {
      proof = await createPrincipalHistoryIndexProof({
        rootHash: history.indexRootHash,
        treeSize: history.currentEntry.state.version,
        version: reference.version,
        readNode: (hash) => readBufferedPrincipalHistoryNode(executor, hash),
      });
    } catch (error) {
      // Scope, position and the root came from the locally finished prefix.
      // Only untrusted node material is read by this proof-construction step.
      if (error instanceof KeyingVerificationError) return null;
      throw error;
    }
    // First authenticate the stored entry independently of the requested
    // citation, so storage corruption keeps its integrity classification.
    references.push({
      reference: principalHistoryHead(entry.state),
      entry,
      proof,
    });
  }
  const selected = await verifyPrincipalPolicyHistoryReferences({
    history,
    references,
  });
  if (!selected.ok) throw principalHistoryError(kind, selected.error.message);
  if (
    references.some(
      (item, index) => !canonicalJsonEquals(item.reference, requested[index]),
    )
  )
    throw new PrincipalPolicyReferenceError();
  return selected.value;
}
