import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  createPrincipalPolicyHistoryVerifier,
  type PrincipalPolicyHistoryInput,
  type PrincipalPolicyHistoryVerifier,
  restorePrincipalPolicyHistoryVerifier,
} from "@tearleads/crypto";
import {
  discardPrincipalHistoryStage,
  loadPrincipalHistoryStage,
  type PrincipalHistoryStage,
} from "../../data/persistence/principalHistoryStagePersistence";
import {
  parsePrincipalHistoryStageCurrent,
  principalHistoryStageId,
  principalHistoryStageProtection,
} from "../../data/principals/principalHistoryStageProtection";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

export interface PrincipalHistoryRecoveryStage {
  readonly id: string;
  readonly verifier: PrincipalPolicyHistoryVerifier;
  current: PrincipalPolicyPageCurrent | null;
  saved: PrincipalHistoryStage | null;
}

export async function restorePrincipalHistoryRecoveryStage(
  input: RecoverPrincipalPolicyHistoryOptions,
  historyInput: PrincipalPolicyHistoryInput,
): Promise<PrincipalHistoryRecoveryStage> {
  const id = await principalHistoryStageId(
    input.organizationId,
    input.expectedHead,
    input.protection.context,
  );
  const saved = await loadPrincipalHistoryStage(input.execSql, id);
  if (saved) {
    const current = parsePrincipalHistoryStageCurrent(saved);
    if (current && saved.organizationId === input.organizationId) {
      const restored = await restorePrincipalPolicyHistoryVerifier(
        historyInput,
        saved.progress,
        await principalHistoryStageProtection(
          input.protection,
          input.expectedHead,
          saved,
        ),
      );
      if (restored.ok) return { id, verifier: restored.value, current, saved };
    }
    // Saved bytes are a disposable hint. Only a locally authenticated restore
    // can skip signed history; missing keys or changed inputs replay genesis.
    await discardPrincipalHistoryStage(
      input.execSql,
      saved,
      () => !input.signal?.aborted && input.stillCurrent(),
    );
  }
  return {
    id,
    verifier: createPrincipalPolicyHistoryVerifier(historyInput),
    current: null,
    saved: null,
  };
}
