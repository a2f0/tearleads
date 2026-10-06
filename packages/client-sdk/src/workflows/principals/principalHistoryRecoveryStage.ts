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
import { principalHistoryEvidenceScopeId } from "../../data/principals/principalHistoryPrefixProtection";
import {
  parsePrincipalHistoryStageCurrent,
  principalHistoryStageId,
  principalHistoryStageProtection,
} from "../../data/principals/principalHistoryStageProtection";
import { restoreReusablePrincipalHistoryPrefix } from "./principalHistoryRecoveryPrefix";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

export interface PrincipalHistoryRecoveryStage {
  readonly id: string;
  readonly scopeId: string;
  readonly verifier: PrincipalPolicyHistoryVerifier;
  readonly initialAfterVersion: number;
  readonly fromCache: boolean;
  complete: boolean;
  current: PrincipalPolicyPageCurrent | null;
  saved: PrincipalHistoryStage | null;
}

export async function restorePrincipalHistoryRecoveryStage(
  input: RecoverPrincipalPolicyHistoryOptions,
  historyInput: PrincipalPolicyHistoryInput,
  useReusablePrefix = true,
): Promise<PrincipalHistoryRecoveryStage> {
  const scopeId = await principalHistoryEvidenceScopeId({
    organizationId: input.organizationId,
    head: input.expectedHead,
    protection: input.protection,
  });
  const id = await principalHistoryStageId(
    input.organizationId,
    input.expectedHead,
    input.protection.context,
    input.retainedReferences ?? [],
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
      if (restored.ok)
        return {
          id,
          scopeId,
          verifier: restored.value,
          current,
          saved,
          complete: saved.complete,
          initialAfterVersion: saved.afterVersion,
          fromCache: true,
        };
    }
    // Saved bytes are a disposable hint. Only a locally authenticated restore
    // can skip signed history; missing keys or changed inputs replay genesis.
    await discardPrincipalHistoryStage(
      input.execSql,
      saved,
      () => !input.signal?.aborted && input.stillCurrent(),
    );
  }
  const prefix = useReusablePrefix
    ? await restoreReusablePrincipalHistoryPrefix(input, historyInput, scopeId)
    : null;
  if (prefix) {
    const complete = prefix.version === input.expectedHead.version;
    return {
      id,
      scopeId,
      verifier: prefix.verifier,
      current: complete ? prefix.current : null,
      saved: null,
      complete,
      initialAfterVersion: prefix.version - (complete ? 1 : 0),
      fromCache: true,
    };
  }
  return {
    id,
    scopeId,
    verifier: createPrincipalPolicyHistoryVerifier(historyInput),
    current: null,
    saved: null,
    complete: false,
    initialAfterVersion: 0,
    fromCache: false,
  };
}
