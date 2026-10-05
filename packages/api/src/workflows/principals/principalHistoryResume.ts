import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  createPrincipalPolicyHistoryVerifier,
  type PrincipalPolicyHistoryInput,
  type PrincipalPolicyHistoryVerifier,
  type ReferencedPrincipalHead,
  restorePrincipalPolicyHistoryVerifier,
} from "@tearleads/crypto";
import { selectPrincipalHistoryProgress } from "../../access/read/principalHistoryProgress";
import {
  discardPrincipalHistoryProgress,
  upsertPrincipalHistoryProgress,
} from "../../access/write/principalHistoryProgress";
import type { principalHistoryProtection } from "./principalHistoryProtection";
import {
  assertPrincipalHistoryEntryUnchanged,
  principalHistoryError,
  principalHistoryHead,
} from "./principalHistoryRecords";

type Protection = ReturnType<typeof principalHistoryProtection>;

export async function resumeStoredPrincipalHistory(
  executor: DatabaseSession,
  input: PrincipalPolicyHistoryInput,
  throughVersion: number,
  local: Protection,
): Promise<{
  readonly verifier: PrincipalPolicyHistoryVerifier;
  readonly throughVersion: number;
  readonly discarded: boolean;
}> {
  // Validate server-owned scope/reference input even if there is no saved row.
  const initial = createPrincipalPolicyHistoryVerifier(input);
  const saved = await selectPrincipalHistoryProgress(executor, {
    ...local.scope,
    throughVersion,
  });
  if (saved) {
    const restored = await restorePrincipalPolicyHistoryVerifier(
      input,
      saved.progress,
      local.protection,
    );
    if (restored.ok) {
      // Authenticate the untrusted lookup metadata with the verifier's exact
      // six-field head check before it can influence the next SQL range.
      const finished = restored.value.finish(principalHistoryHead(saved));
      if (finished.ok) {
        await assertPrincipalHistoryEntryUnchanged(
          executor,
          finished.value.currentEntry,
          local.scope.verificationKind,
        );
        return {
          verifier: restored.value,
          throughVersion: finished.value.currentEntry.state.version,
          discarded: false,
        };
      }
    }
    await discardPrincipalHistoryProgress(executor, saved);
  }
  return { verifier: initial, throughVersion: 0, discarded: saved !== null };
}

export async function saveStoredPrincipalHistory(
  executor: DatabaseSession,
  verifier: PrincipalPolicyHistoryVerifier,
  head: ReferencedPrincipalHead,
  local: Protection,
): Promise<void> {
  const finished = verifier.finish(principalHistoryHead(head));
  if (!finished.ok)
    throw principalHistoryError(
      local.scope.verificationKind,
      finished.error.message,
    );
  const exported = await verifier.exportProgress(local.protection);
  if (!exported.ok)
    throw principalHistoryError(
      local.scope.verificationKind,
      exported.error.message,
    );
  await upsertPrincipalHistoryProgress(executor, {
    ...local.scope,
    principalType: head.principalType,
    principalId: head.principalId,
    version: head.version,
    keyEpoch: head.keyEpoch,
    stateHash: head.stateHash,
    keyFingerprint: head.keyFingerprint,
    progress: exported.value,
  });
}
