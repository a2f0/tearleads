import {
  createPrincipalPolicyHistoryVerifier,
  restorePrincipalPolicyHistoryVerifier,
  serializeKeyingCanonicalJson,
  type VerifiedPrincipalPolicyHistory,
} from "@tearleads/crypto";
import { isReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import {
  discardPrincipalHistoryPrefix,
  loadPrincipalHistoryPrefix,
  savePrincipalHistoryPrefix,
} from "../../data/persistence/principalHistoryPrefixPersistence";
import {
  discardPrincipalHistoryStage,
  loadPrincipalHistoryStage,
} from "../../data/persistence/principalHistoryStagePersistence";
import {
  principalHistoryEvidenceScopeId,
  principalHistoryPrefixProtection,
} from "../../data/principals/principalHistoryPrefixProtection";
import {
  principalHistoryStageId,
  principalHistoryStageProtection,
} from "../../data/principals/principalHistoryStageProtection";
import {
  parsePublicHistoryAuthority,
  publicHistoryAuthorityJson,
  validatePublicHistoryAuthority,
} from "./publicPrincipalHistoryAuthority";
import type {
  PublicPrincipalHistoryOptions,
  PublicPrincipalHistoryProgress,
} from "./publicPrincipalHistoryTypes";

async function restorePublicPrefix(
  input: PublicPrincipalHistoryOptions,
  scopeId: string,
  id: string,
): Promise<PublicPrincipalHistoryProgress | null> {
  const head = input.source.head;
  const historyInput = {
    principalType: head.principalType,
    principalId: head.principalId,
  };
  const current = () => !input.signal?.aborted && input.stillCurrent();
  const prefix = await loadPrincipalHistoryPrefix(input.execSql, scopeId);
  if (prefix) {
    const authorityReference = parsePublicHistoryAuthority(
      input,
      prefix.currentJson,
    );
    let prefixHead: unknown;
    try {
      prefixHead = JSON.parse(prefix.headJson);
    } catch {
      prefixHead = null;
    }
    if (
      prefix.organizationId === input.organizationId &&
      authorityReference !== undefined &&
      isReferencedPrincipalStateResponse(prefixHead) &&
      prefixHead.principalId === head.principalId &&
      prefixHead.principalType === head.principalType &&
      prefixHead.version === prefix.version
    ) {
      const restored = await restorePrincipalPolicyHistoryVerifier(
        historyInput,
        prefix.progress,
        await principalHistoryPrefixProtection(input.protection, prefix),
      );
      if (restored.ok && restored.value.finish(prefixHead).ok) {
        await validatePublicHistoryAuthority(input, authorityReference);
        return {
          id,
          scopeId,
          verifier: restored.value,
          completedHead: prefixHead.version >= head.version ? prefixHead : null,
          afterVersion: Math.min(prefixHead.version, head.version - 1),
          saved: null,
          authorityReference,
        };
      }
    }
    if (!input.offline)
      await discardPrincipalHistoryPrefix({
        execSql: input.execSql,
        prefix,
        stillCurrent: current,
      });
  }
  return null;
}

export async function restorePublicPrincipalHistoryProgress(
  input: PublicPrincipalHistoryOptions,
  allowReuse: boolean,
): Promise<PublicPrincipalHistoryProgress> {
  const head = input.source.head;
  const historyInput = {
    principalType: head.principalType,
    principalId: head.principalId,
  };
  const scopeId = await principalHistoryEvidenceScopeId({
    organizationId: input.organizationId,
    head,
    protection: input.protection,
  });
  const id = await principalHistoryStageId(
    input.organizationId,
    head,
    input.protection.context,
  );
  const current = () => !input.signal?.aborted && input.stillCurrent();
  const saved = await loadPrincipalHistoryStage(input.execSql, id);
  if (saved) {
    const authorityReference = parsePublicHistoryAuthority(
      input,
      saved.currentJson,
    );
    if (
      allowReuse &&
      saved.organizationId === input.organizationId &&
      authorityReference !== undefined
    ) {
      const restored = await restorePrincipalPolicyHistoryVerifier(
        historyInput,
        saved.progress,
        await principalHistoryStageProtection(input.protection, head, saved),
      );
      if (restored.ok && (!saved.complete || restored.value.finish(head).ok)) {
        await validatePublicHistoryAuthority(input, authorityReference);
        return {
          id,
          scopeId,
          verifier: restored.value,
          completedHead: saved.complete ? head : null,
          afterVersion: saved.afterVersion,
          saved,
          authorityReference,
        };
      }
    }
    if (!input.offline)
      await discardPrincipalHistoryStage(input.execSql, saved, current);
  }
  if (allowReuse) {
    const prefix = await restorePublicPrefix(input, scopeId, id);
    if (prefix) return prefix;
  }
  return {
    id,
    scopeId,
    verifier: createPrincipalPolicyHistoryVerifier(historyInput),
    completedHead: null,
    afterVersion: 0,
    saved: null,
    authorityReference: null,
  };
}

export async function publishPublicPrincipalHistoryPrefix(
  input: PublicPrincipalHistoryOptions,
  progress: PublicPrincipalHistoryProgress,
  history: VerifiedPrincipalPolicyHistory,
): Promise<void> {
  const state = history.currentEntry.state;
  const head = {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    stateHash: state.stateHash,
    keyEpoch: state.keyEpoch,
    keyFingerprint: state.keyFingerprint,
  };
  const prefix = {
    scopeId: progress.scopeId,
    organizationId: input.organizationId,
    version: head.version,
    headJson: serializeKeyingCanonicalJson(head),
    currentJson: publicHistoryAuthorityJson(progress.authorityReference),
  };
  const sealed = await progress.verifier.exportProgress(
    await principalHistoryPrefixProtection(input.protection, prefix),
  );
  if (!sealed.ok) throw sealed.error;
  const stillCurrent = () => !input.signal?.aborted && input.stillCurrent();
  await savePrincipalHistoryPrefix({
    execSql: input.execSql,
    prefix: { ...prefix, progress: sealed.value },
    stillCurrent,
  });
  if (progress.saved)
    await discardPrincipalHistoryStage(
      input.execSql,
      progress.saved,
      stillCurrent,
    );
}
