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

export async function sealPrincipalCurrentPublication(
  options: RecoverPrincipalPolicyHistoryOptions,
  scopeId: string,
  expectedHead: ReferencedPrincipalHead,
  verifier: PrincipalPolicyHistoryVerifier,
  response: PrincipalPolicyPageCurrent,
) {
  const wireCurrent = {
    currentState: response.currentState,
    currentProjection: response.currentProjection,
    currentGrants: response.currentGrants,
    currentPayload: response.currentPayload,
    currentMemberEnvelopes: response.currentMemberEnvelopes,
  };
  const currentJson = JSON.stringify(wireCurrent);
  const prefix = {
    scopeId,
    organizationId: options.organizationId,
    version: expectedHead.version,
    headJson: serializeKeyingCanonicalJson({ ...expectedHead }),
    currentJson,
  };
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
  const prefixProgress = await verifier.exportProgress(
    await principalHistoryPrefixProtection(options.protection, prefix),
  );
  if (!prefixProgress.ok) throw prefixProgress.error;
  const stageProgress = await verifier.exportProgress(
    await principalHistoryStageProtection(
      options.protection,
      expectedHead,
      stage,
    ),
  );
  if (!stageProgress.ok) throw stageProgress.error;
  return {
    prefix: { ...prefix, progress: prefixProgress.value },
    stage: { ...stage, progress: stageProgress.value },
  };
}
