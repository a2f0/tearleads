import {
  createPrincipalPolicyHistoryVerifier,
  KeyingVerificationError,
  restorePrincipalPolicyHistoryVerifier,
  serializeKeyingCanonicalJson,
  type VerifiedPrincipalPolicyHistory,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import { isReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { loadPrincipalHistoryReference } from "../../../data/persistence/principalHistory/principalHistoryEvidencePersistence";
import {
  discardPrincipalHistoryPrefix,
  loadPrincipalHistoryPrefix,
  type PrincipalHistoryPrefix,
  savePrincipalHistoryPrefix,
} from "../../../data/persistence/principalHistory/principalHistoryPrefixPersistence";
import {
  discardPrincipalHistoryStage,
  loadPrincipalHistoryStage,
} from "../../../data/persistence/principalHistory/principalHistoryStagePersistence";
import { principalHeadMatchesReference } from "../../../data/principals/organizationAuthorityDescriptor";
import {
  principalHistoryEvidenceScopeId,
  principalHistoryPrefixProtection,
} from "../../../data/principals/principalHistoryPrefixProtection";
import {
  principalHistoryStageId,
  principalHistoryStageProtection,
} from "../../../data/principals/principalHistoryStageProtection";
import {
  PublicHistoryAuthorityUnavailableError,
  parsePublicHistoryAuthority,
  publicHistoryAuthorityJson,
  validatePublicHistoryAuthority,
} from "./publicPrincipalHistoryAuthority";
import type {
  PublicPrincipalHistoryOptions,
  PublicPrincipalHistoryProgress,
} from "./publicPrincipalHistoryTypes";

function parsedJsonOrNull(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function restorePublicPrefix(
  input: PublicPrincipalHistoryOptions,
  scopeId: string,
  id: string,
  prefix: PrincipalHistoryPrefix | null,
): Promise<PublicPrincipalHistoryProgress | null> {
  const head = input.source.head;
  const historyInput = {
    principalType: head.principalType,
    principalId: head.principalId,
  };
  const current = () => !input.signal?.aborted && input.stillCurrent();
  if (prefix) {
    const authorityReference = parsePublicHistoryAuthority(
      input,
      prefix.currentJson,
    );
    const prefixHead = parsedJsonOrNull(prefix.headJson);
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
        await validatePublicHistoryAuthority(input, authorityReference, prefix);
        return {
          id,
          scopeId,
          verifier: restored.value,
          completedHead: prefixHead.version >= head.version ? prefixHead : null,
          afterVersion: Math.min(prefixHead.version, head.version - 1),
          saved: null,
          cachedPrefix: prefix,
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

type RestoredVerifier = Awaited<
  ReturnType<typeof restorePrincipalPolicyHistoryVerifier>
>;

/** A restored verifier is reusable when a completed stage still finishes. */
function finishesSavedHistory(
  restored: RestoredVerifier,
  complete: boolean,
  head: PublicPrincipalHistoryOptions["source"]["head"],
): restored is Extract<RestoredVerifier, { ok: true }> {
  return restored.ok && (!complete || restored.value.finish(head).ok);
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
      if (finishesSavedHistory(restored, saved.complete, head)) {
        await validatePublicHistoryAuthority(input, authorityReference);
        return {
          id,
          scopeId,
          verifier: restored.value,
          completedHead: saved.complete ? head : null,
          afterVersion: saved.afterVersion,
          saved,
          cachedPrefix: null,
          authorityReference,
        };
      }
    }
    if (!input.offline)
      await discardPrincipalHistoryStage(input.execSql, saved, current);
  }
  const prefix = allowReuse
    ? await restorePublicPrefix(
        input,
        scopeId,
        id,
        await loadPrincipalHistoryPrefix(input.execSql, scopeId),
      )
    : null;
  if (prefix) return prefix;
  return {
    id,
    scopeId,
    verifier: createPrincipalPolicyHistoryVerifier(historyInput),
    completedHead: null,
    afterVersion: 0,
    saved: null,
    cachedPrefix: null,
    authorityReference: null,
  };
}

/** A resumed stage may finish after the reader that rejected the prefix exits. */
async function rejectedCompletedPrefix(
  input: PublicPrincipalHistoryOptions,
  progress: PublicPrincipalHistoryProgress,
  history: VerifiedPrincipalPolicyHistory,
): Promise<PrincipalHistoryPrefix | null> {
  const candidate = await loadPrincipalHistoryPrefix(
    input.execSql,
    progress.scopeId,
  );
  if (!candidate || candidate.version <= history.currentEntry.state.version)
    return null;
  try {
    const cached = await restorePublicPrefix(
      input,
      progress.scopeId,
      progress.id,
      candidate,
    );
    if (!cached?.completedHead) return null;
    const finished = cached.verifier.finish(cached.completedHead);
    if (!finished.ok) throw finished.error;
    const proof = await loadPrincipalHistoryReference({
      execSql: input.execSql,
      scopeId: progress.scopeId,
      history: finished.value,
      version: input.source.head.version,
    });
    const verified = await verifyPrincipalPolicyHistoryReferences({
      history: finished.value,
      references: [proof],
    });
    if (!verified.ok) throw verified.error;
    return principalHeadMatchesReference(proof.entry.state, input.source.head)
      ? null
      : candidate;
  } catch (error) {
    if (
      error instanceof KeyingVerificationError ||
      error instanceof PublicHistoryAuthorityUnavailableError
    )
      return candidate;
    throw error;
  }
}

export async function publishPublicPrincipalHistoryPrefix(
  input: PublicPrincipalHistoryOptions,
  progress: PublicPrincipalHistoryProgress,
  history: VerifiedPrincipalPolicyHistory,
  rejectedPrefix: PrincipalHistoryPrefix | null,
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
  const rejected =
    rejectedPrefix ??
    (progress.cachedPrefix
      ? null
      : await rejectedCompletedPrefix(input, progress, history));
  const stillCurrent = () => !input.signal?.aborted && input.stillCurrent();
  await savePrincipalHistoryPrefix({
    indexRootHash: history.indexRootHash,
    execSql: input.execSql,
    prefix: { ...prefix, progress: sealed.value },
    stillCurrent,
    rejectedPrefix: rejected,
  });
  if (progress.saved)
    await discardPrincipalHistoryStage(
      input.execSql,
      progress.saved,
      stillCurrent,
    );
}
