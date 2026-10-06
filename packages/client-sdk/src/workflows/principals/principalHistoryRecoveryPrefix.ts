import {
  type PrincipalPolicyHistoryInput,
  type PrincipalPolicyHistoryVerifier,
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
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";

export async function restoreReusablePrincipalHistoryPrefix(
  options: RecoverPrincipalPolicyHistoryOptions,
  historyInput: PrincipalPolicyHistoryInput,
  scopeId: string,
): Promise<{
  verifier: PrincipalPolicyHistoryVerifier;
  version: number;
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
    head.version === saved.version
  ) {
    const restored = await restorePrincipalPolicyHistoryVerifier(
      historyInput,
      saved.progress,
      principalHistoryPrefixProtection(options.protection, saved),
    );
    if (restored.ok && restored.value.finish(head).ok) {
      if (saved.version > options.expectedHead.version) return null;
      if (
        saved.version < options.expectedHead.version ||
        restored.value.finish(options.expectedHead).ok
      )
        return { verifier: restored.value, version: saved.version };
    }
  }
  await discardPrincipalHistoryPrefix({
    execSql: options.execSql,
    prefix: saved,
    stillCurrent: () => !options.signal?.aborted && options.stillCurrent(),
  });
  return null;
}

/** The verifier must use stable empty selection/checkpoint inputs. */
export async function publishReusablePrincipalHistoryPrefix(
  options: RecoverPrincipalPolicyHistoryOptions,
  scopeId: string,
  verifier: PrincipalPolicyHistoryVerifier,
): Promise<void> {
  const prefix = {
    scopeId,
    organizationId: options.organizationId,
    version: options.expectedHead.version,
    headJson: serializeKeyingCanonicalJson({ ...options.expectedHead }),
  };
  const sealed = await verifier.exportProgress(
    principalHistoryPrefixProtection(options.protection, prefix),
  );
  if (!sealed.ok) throw sealed.error;
  await savePrincipalHistoryPrefix({
    execSql: options.execSql,
    prefix: { ...prefix, progress: sealed.value },
    stillCurrent: () => !options.signal?.aborted && options.stillCurrent(),
  });
}
