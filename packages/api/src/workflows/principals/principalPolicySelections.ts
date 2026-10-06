import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type ReferencedPrincipalHead,
  selectPrincipalPolicyAuthorization,
  type VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { getVerifiedPrincipalHistory } from "./getVerifiedPrincipalHistory";
import {
  principalHistoryError,
  principalHistoryHead,
} from "./principalHistoryRecords";
import { PrincipalPolicyReferenceError } from "./shared";

/** Historical public evidence needs no live group, payload, or envelopes. */
export async function loadPrincipalPolicySelections(
  executor: DatabaseSession,
  references: readonly ReferencedPrincipalHead[],
): Promise<VerifiedPrincipalPolicySelection[]> {
  const principals = new Map<string, Map<number, ReferencedPrincipalHead>>();
  for (const reference of references) {
    const key = `${reference.principalType}:${reference.principalId}`;
    const grouped = principals.get(key) ?? new Map();
    const head = principalHistoryHead(reference);
    const existing = grouped.get(head.version);
    if (existing && !canonicalJsonEquals(existing, head))
      throw new PrincipalPolicyReferenceError();
    grouped.set(head.version, head);
    principals.set(key, grouped);
  }
  const policies: VerifiedPrincipalPolicySelection[] = [];
  for (const heads of principals.values()) {
    const grouped = [...heads.values()];
    // Pin to the highest cited state, even if this principal has been deleted.
    // Every other citation must prove inclusion in that same verified prefix.
    const head = grouped.reduce((latest, reference) =>
      reference.version > latest.version ? reference : latest,
    );
    for (
      let offset = 0;
      offset < grouped.length;
      offset += PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT
    ) {
      const history = await getVerifiedPrincipalHistory(
        executor,
        head,
        grouped.slice(offset, offset + PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT),
      );
      const selected = await selectPrincipalPolicyAuthorization(history);
      if (!selected.ok)
        throw principalHistoryError("policy", selected.error.message);
      policies.push(selected.value);
    }
  }
  return policies;
}
