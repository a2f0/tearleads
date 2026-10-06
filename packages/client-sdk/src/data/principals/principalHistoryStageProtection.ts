import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  type PrincipalPolicyHistoryProgressOptions,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
  toFingerprint,
} from "@tearleads/crypto";
import { isPrincipalPolicyPageResponse } from "@tearleads/validators/response";
import type { PrincipalHistoryStage } from "../persistence/principalHistoryStagePersistence";

export function principalHistoryStageId(
  organizationId: string,
  head: ReferencedPrincipalHead,
  context: string,
  retainedReferences: readonly ReferencedPrincipalHead[],
) {
  return toFingerprint(
    new TextEncoder().encode(
      serializeKeyingCanonicalJson([
        "tearleads.sdk.principal-history-stage.v1",
        organizationId,
        head.principalType,
        head.principalId,
        head.version,
        head.keyEpoch,
        head.stateHash,
        head.keyFingerprint,
        context,
        [...retainedReferences]
          .sort((a, b) => a.version - b.version)
          .map((reference) => [
            reference.principalType,
            reference.principalId,
            reference.version,
            reference.keyEpoch,
            reference.stateHash,
            reference.keyFingerprint,
          ]),
      ]),
    ),
  );
}

export async function principalHistoryStageProtection(
  protection: PrincipalPolicyHistoryProgressOptions,
  expectedHead: ReferencedPrincipalHead,
  stage: Omit<PrincipalHistoryStage, "progress">,
): Promise<PrincipalPolicyHistoryProgressOptions> {
  return {
    localKey: protection.localKey,
    context: serializeKeyingCanonicalJson({
      domain: "tearleads.sdk.principal-history-stage.v1",
      context: protection.context,
      id: stage.id,
      organizationId: stage.organizationId,
      expectedHead: { ...expectedHead },
      afterVersion: stage.afterVersion,
      complete: stage.complete,
      currentDigest: await toFingerprint(
        new TextEncoder().encode(stage.currentJson),
      ),
    }),
  };
}

export function parsePrincipalHistoryStageCurrent(
  stage: Pick<PrincipalHistoryStage, "currentJson" | "afterVersion">,
): PrincipalPolicyPageCurrent | null {
  let current: unknown;
  try {
    current = JSON.parse(stage.currentJson);
  } catch {
    return null;
  }
  if (!current || typeof current !== "object" || Array.isArray(current))
    return null;
  const page = {
    ...current,
    previousStates: [],
    historyPage: { afterVersion: stage.afterVersion, nextAfterVersion: null },
  };
  if (
    !isPrincipalPolicyPageResponse(page) ||
    stage.afterVersion >= page.currentState.version
  )
    return null;
  return {
    currentState: page.currentState,
    currentPayload: page.currentPayload,
    currentProjection: page.currentProjection,
    currentGrants: page.currentGrants,
    currentMemberEnvelopes: page.currentMemberEnvelopes,
  };
}
