import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  type PrincipalPolicyHistoryVerifier,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { principalHistoryPrefixProtection } from "../../data/principals/principalHistoryPrefixProtection";
import {
  principalHistoryStageId,
  principalHistoryStageProtection,
} from "../../data/principals/principalHistoryStageProtection";
import type { RecoverPrincipalPolicyHistoryOptions } from "../principals/principalHistoryRecoveryTypes";

function exactHead(head: ReferencedPrincipalHead): ReferencedPrincipalHead {
  return {
    principalType: head.principalType,
    principalId: head.principalId,
    version: head.version,
    keyEpoch: head.keyEpoch,
    stateHash: head.stateHash,
    keyFingerprint: head.keyFingerprint,
  };
}

export async function sealPrincipalCurrentStage(
  options: RecoverPrincipalPolicyHistoryOptions,
  expectedHead: ReferencedPrincipalHead,
  verifier: PrincipalPolicyHistoryVerifier,
  response: PrincipalPolicyPageCurrent,
) {
  // Authentication uses the reference contract, never extra signed-state fields.
  expectedHead = exactHead(expectedHead);
  const currentJson = JSON.stringify({
    currentState: response.currentState,
    currentProjection: response.currentProjection,
    currentGrants: response.currentGrants,
    currentPayload: response.currentPayload,
    currentMemberEnvelopes: response.currentMemberEnvelopes,
  });
  const stage = {
    id: await principalHistoryStageId(
      options.organizationId,
      expectedHead,
      options.protection.context,
    ),
    organizationId: options.organizationId,
    afterVersion: expectedHead.version - 1,
    complete: true,
    currentJson,
  };
  const progress = await verifier.exportProgress(
    await principalHistoryStageProtection(
      options.protection,
      expectedHead,
      stage,
    ),
  );
  if (!progress.ok) throw progress.error;
  return { ...stage, progress: progress.value };
}

export async function sealPrincipalCurrentPublication(
  options: RecoverPrincipalPolicyHistoryOptions,
  scopeId: string,
  expectedHead: ReferencedPrincipalHead,
  verifier: PrincipalPolicyHistoryVerifier,
  response: PrincipalPolicyPageCurrent,
) {
  expectedHead = exactHead(expectedHead);
  const stage = await sealPrincipalCurrentStage(
    options,
    expectedHead,
    verifier,
    response,
  );
  const prefix = {
    scopeId,
    organizationId: options.organizationId,
    version: expectedHead.version,
    headJson: serializeKeyingCanonicalJson({ ...expectedHead }),
    currentJson: stage.currentJson,
  };
  const progress = await verifier.exportProgress(
    await principalHistoryPrefixProtection(options.protection, prefix),
  );
  if (!progress.ok) throw progress.error;
  return { prefix: { ...prefix, progress: progress.value }, stage };
}
