import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyHistoryInput,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PrincipalPolicyPageResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  discardPrincipalHistoryStage,
  savePrincipalHistoryStage,
} from "../../data/persistence/principalHistoryStagePersistence";
import { principalHistoryStageProtection } from "../../data/principals/principalHistoryStageProtection";
import { collectPrincipalPolicySignerPublicKeys } from "./policyVerification";
import {
  type PrincipalHistoryRecoveryStage,
  restorePrincipalHistoryRecoveryStage,
} from "./principalHistoryRecoveryStage";
import {
  PrincipalPolicyHistoryReadError,
  type RecoveredPrincipalPolicyHistory,
  type RecoverPrincipalPolicyHistoryOptions,
} from "./principalHistoryRecoveryTypes";

function currentArtifacts(
  page: PrincipalPolicyPageResponse,
): PrincipalPolicyPageCurrent {
  return {
    currentState: page.currentState,
    currentPayload: page.currentPayload,
    currentProjection: page.currentProjection,
    currentGrants: page.currentGrants,
    currentMemberEnvelopes: page.currentMemberEnvelopes,
  };
}

function assertCurrent(input: RecoverPrincipalPolicyHistoryOptions): void {
  assertProjectionVerificationCurrent(
    () => !input.signal?.aborted && input.stillCurrent(),
  );
}

async function acceptPage(
  input: RecoverPrincipalPolicyHistoryOptions,
  stage: PrincipalHistoryRecoveryStage,
  response: PrincipalPolicyPageResponse,
): Promise<void> {
  const page = structuredClone(response);
  assertCurrent(input);
  for (const field of [
    "principalType",
    "principalId",
    "version",
    "stateHash",
    "keyEpoch",
    "keyFingerprint",
  ] as const) {
    if (page.currentState[field] !== input.expectedHead[field])
      throw new KeyingVerificationError(
        "object_mismatch",
        "Principal history page does not match its requested head",
      );
  }
  if (stage.saved?.complete) {
    if (
      page.previousStates.length !== 0 ||
      page.historyPage.nextAfterVersion !== null
    )
      throw new KeyingVerificationError(
        "invalid_shape",
        "Completed history returned additional entries",
      );
    return;
  }
  const complete = page.historyPage.nextAfterVersion === null;
  const current = currentArtifacts(page);
  const entries = [...page.previousStates];
  if (complete)
    entries.push({
      state: current.currentState,
      projection: current.currentProjection,
      grants: current.currentGrants,
    });
  const keys = await collectPrincipalPolicySignerPublicKeys({
    bundle: { ...current, previousStates: page.previousStates },
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in keys)
    throw new KeyingVerificationError(
      keys.error === "not-found" ? "missing_dependency" : "signer_mismatch",
      "Principal history signer identity could not be authenticated",
    );
  const externalAuthority = await input.loadExternalAuthority?.(entries);
  const appended = await stage.verifier.append({
    entries,
    signerPublicKeys: keys.signerPublicKeys,
    ...(externalAuthority ? { externalAuthority } : {}),
  });
  if (!appended.ok) throw appended.error;
  const next = {
    id: stage.id,
    organizationId: input.organizationId,
    currentJson: JSON.stringify(current),
    afterVersion: appended.value.throughVersion - (complete ? 1 : 0),
    complete,
  };
  const protectedProgress = await stage.verifier.exportProgress(
    await principalHistoryStageProtection(
      input.protection,
      input.expectedHead,
      next,
    ),
  );
  if (!protectedProgress.ok) throw protectedProgress.error;
  const saved = { ...next, progress: protectedProgress.value };
  await savePrincipalHistoryStage({
    execSql: input.execSql,
    stage: saved,
    previousProgress: stage.saved?.progress ?? null,
    stillCurrent: () => !input.signal?.aborted && input.stillCurrent(),
  });
  stage.current = current;
  stage.saved = saved;
}

async function finishRecovery(
  input: RecoverPrincipalPolicyHistoryOptions,
  stage: PrincipalHistoryRecoveryStage,
  checkpoint: PrincipalPolicyCheckpoint | null,
): Promise<RecoveredPrincipalPolicyHistory> {
  if (!stage.current || !stage.saved?.complete)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Principal history ended before its pinned head",
    );
  const history = stage.verifier.finish(input.expectedHead);
  if (!history.ok) throw history.error;
  const current = await verifyPrincipalPolicyCurrent({
    current: stage.current,
    history: history.value,
  });
  if (!current.ok) throw current.error;
  const latest = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    input.expectedHead.principalType,
    input.expectedHead.principalId,
  );
  if (
    latest?.version !== checkpoint?.version ||
    latest?.stateHash !== checkpoint?.stateHash
  )
    throw new KeyingVerificationError(
      "stale_predecessor",
      "Local principal checkpoint changed during history recovery",
    );
  assertCurrent(input);
  return { current: stage.current, policy: current.value };
}

async function recover(
  input: RecoverPrincipalPolicyHistoryOptions,
): Promise<RecoveredPrincipalPolicyHistory> {
  assertCurrent(input);
  const checkpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    input.expectedHead.principalType,
    input.expectedHead.principalId,
  );
  if (checkpoint && input.expectedHead.version < checkpoint.version)
    throw new KeyingVerificationError(
      "rollback",
      "Requested principal history predates the local checkpoint",
    );
  const historyInput: PrincipalPolicyHistoryInput = {
    principalType: input.expectedHead.principalType,
    principalId: input.expectedHead.principalId,
    localCheckpoint: checkpoint,
    retainedReferences: input.retainedReferences ?? [],
  };
  const stage = await restorePrincipalHistoryRecoveryStage(input, historyInput);
  let receivedFinalPage = false;
  for await (const result of input.apiClient.getPrincipalPolicyPages(
    input.expectedHead.principalType,
    input.expectedHead.principalId,
    {
      signal: input.signal,
      stateHash: input.expectedHead.stateHash,
      ...(stage.saved && stage.current
        ? {
            resume: {
              current: stage.current,
              afterVersion: stage.saved.afterVersion,
            },
          }
        : {}),
    },
  )) {
    if (!result.ok) {
      // A rejected transport pin cannot justify skipping history on retry.
      // Discard only this operation's progress, then let a new call replay it.
      if (result.kind === "shape" && stage.saved)
        await discardPrincipalHistoryStage(
          input.execSql,
          stage.saved,
          () => !input.signal?.aborted && input.stillCurrent(),
        );
      throw new PrincipalPolicyHistoryReadError(result);
    }
    await acceptPage(input, stage, result.data);
    receivedFinalPage = result.data.historyPage.nextAfterVersion === null;
  }
  if (!receivedFinalPage)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Principal history transport did not complete",
    );
  return finishRecovery(input, stage, checkpoint);
}

/**
 * Recover one exact head with bounded retained history and durable checked progress.
 * The result is a sparse current-policy capability; this does not advance app checkpoints.
 */
export async function recoverPrincipalPolicyHistory(
  options: RecoverPrincipalPolicyHistoryOptions,
): Promise<RecoveredPrincipalPolicyHistory> {
  if (
    !options.organizationId ||
    (options.expectedHead.principalType === "organization" &&
      options.expectedHead.principalId !== options.organizationId)
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Principal history organization scope is invalid",
    );
  if (
    options.retainedReferences?.some(
      (reference) => reference.version > options.expectedHead.version,
    )
  )
    throw new KeyingVerificationError(
      "missing_dependency",
      "Requested history reference is beyond the recovery head",
    );
  if (
    !(options.protection.localKey instanceof Uint8Array) ||
    options.protection.localKey.byteLength !== 32 ||
    !options.protection.context
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Principal history recovery requires a private 32-byte key and trust context",
    );
  const input = {
    ...options,
    expectedHead: structuredClone(options.expectedHead),
    retainedReferences: structuredClone(options.retainedReferences ?? []),
    protection: {
      context: options.protection.context,
      localKey: new Uint8Array(options.protection.localKey),
    },
  };
  try {
    return await recover(input);
  } finally {
    input.protection.localKey.fill(0);
  }
}
