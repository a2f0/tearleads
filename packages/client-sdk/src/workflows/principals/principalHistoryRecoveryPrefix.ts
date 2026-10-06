import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  type PrincipalPolicyHistoryInput,
  type PrincipalPolicyHistoryVerifier,
  type ReferencedPrincipalHead,
  restorePrincipalPolicyHistoryVerifier,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { isReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import {
  discardPrincipalHistoryPrefix,
  loadPrincipalHistoryPrefix,
  savePrincipalHistoryPrefix,
} from "../../data/persistence/principalHistoryPrefixPersistence";
import { principalHistoryPrefixProtection } from "../../data/principals/principalHistoryPrefixProtection";
import { parsePrincipalHistoryStageCurrent } from "../../data/principals/principalHistoryStageProtection";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

export async function loadVerifiedPrincipalHistoryPrefix(
  options: Omit<RecoverPrincipalPolicyHistoryOptions, "expectedHead">,
  historyInput: PrincipalPolicyHistoryInput,
  scopeId: string,
): Promise<{
  verifier: PrincipalPolicyHistoryVerifier;
  head: ReferencedPrincipalHead;
  current: PrincipalPolicyPageCurrent;
} | null> {
  const saved = await loadPrincipalHistoryPrefix(options.execSql, scopeId);
  if (!saved) return null;
  let head: unknown;
  try {
    head = JSON.parse(saved.headJson);
  } catch {
    head = null;
  }
  if (
    saved.organizationId === options.organizationId &&
    isReferencedPrincipalStateResponse(head) &&
    head.principalType === historyInput.principalType &&
    head.principalId === historyInput.principalId &&
    head.version === saved.version
  ) {
    const restored = await restorePrincipalPolicyHistoryVerifier(
      historyInput,
      saved.progress,
      await principalHistoryPrefixProtection(options.protection, saved),
    );
    const current = parsePrincipalHistoryStageCurrent({
      currentJson: saved.currentJson,
      afterVersion: saved.version - 1,
    });
    if (restored.ok && restored.value.finish(head).ok && current)
      return { verifier: restored.value, head, current };
  }
  await discardPrincipalHistoryPrefix({
    execSql: options.execSql,
    prefix: saved,
    stillCurrent: () => !options.signal?.aborted && options.stillCurrent(),
  });
  return null;
}

export async function restoreReusablePrincipalHistoryPrefix(
  options: RecoverPrincipalPolicyHistoryOptions,
  historyInput: PrincipalPolicyHistoryInput,
  scopeId: string,
) {
  const prefix = await loadVerifiedPrincipalHistoryPrefix(
    options,
    historyInput,
    scopeId,
  );
  if (!prefix || prefix.head.version > options.expectedHead.version)
    return null;
  if (
    prefix.head.version < options.expectedHead.version ||
    prefix.verifier.finish(options.expectedHead).ok
  )
    return { ...prefix, version: prefix.head.version };
  // An incompatible target cannot erase an independently valid local hint.
  return null;
}

/** The verifier must use stable empty selection/checkpoint inputs. */
export async function publishReusablePrincipalHistoryPrefix(
  options: RecoverPrincipalPolicyHistoryOptions,
  scopeId: string,
  verifier: PrincipalPolicyHistoryVerifier,
  current: PrincipalPolicyPageCurrent,
): Promise<void> {
  const prefix = {
    scopeId,
    organizationId: options.organizationId,
    version: options.expectedHead.version,
    headJson: serializeKeyingCanonicalJson({ ...options.expectedHead }),
    currentJson: JSON.stringify(current),
  };
  const sealed = await verifier.exportProgress(
    await principalHistoryPrefixProtection(options.protection, prefix),
  );
  if (!sealed.ok) throw sealed.error;
  await savePrincipalHistoryPrefix({
    execSql: options.execSql,
    prefix: { ...prefix, progress: sealed.value },
    stillCurrent: () => !options.signal?.aborted && options.stillCurrent(),
  });
}
