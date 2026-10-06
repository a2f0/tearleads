import {
  KeyingVerificationError,
  type PrincipalPolicyStateChainEntry,
} from "@tearleads/crypto";
import type { PrincipalPolicySnapshotPageResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { preparePrincipalHistoryEvidencePage } from "../../data/persistence/principalHistoryEvidencePersistence";
import { savePrincipalHistoryStage } from "../../data/persistence/principalHistoryStagePersistence";
import { principalHistoryStageProtection } from "../../data/principals/principalHistoryStageProtection";
import { collectPrincipalPolicySignerPublicKeys } from "./policyVerification";
import { PUBLIC_HISTORY_CURRENT_JSON } from "./publicPrincipalHistoryProgress";
import type {
  PublicPrincipalHistoryOptions,
  PublicPrincipalHistoryProgress,
} from "./publicPrincipalHistoryTypes";

function assertPublicAuthorityScope(
  input: PublicPrincipalHistoryOptions,
  entries: readonly PrincipalPolicyStateChainEntry[],
): void {
  if (
    input.strictAdmins &&
    entries.some(
      (entry) =>
        entry.projection.length === 0 ||
        entry.projection.some((member) => member.role !== "admin"),
    )
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Public Admins history must contain only direct admin users",
    );
  if (
    entries.some(
      ({ state }) =>
        state.externalAuthority &&
        state.externalAuthority.principalId !== input.authorityGroupId,
    )
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Public history cites an authority outside its directory binding",
    );
}

export async function appendPublicPrincipalHistoryPage(
  input: PublicPrincipalHistoryOptions,
  progress: PublicPrincipalHistoryProgress,
  page: PrincipalPolicySnapshotPageResponse,
): Promise<PublicPrincipalHistoryProgress> {
  const stillCurrent = () => !input.signal?.aborted && input.stillCurrent();
  const complete = page.historyPage.nextAfterVersion === null;
  const entries = [...page.previousStates];
  if (complete)
    entries.push({
      state: page.currentState,
      projection: page.currentProjection,
      grants: page.currentGrants,
    });
  assertPublicAuthorityScope(input, entries);
  const keys = await collectPrincipalPolicySignerPublicKeys({
    bundle: page,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in keys)
    throw new KeyingVerificationError(
      keys.error === "not-found" ? "missing_dependency" : "signer_mismatch",
      "Public history signer identity is unavailable or mismatched",
    );
  const externalAuthority = await input.loadExternalAuthority?.(entries);
  if (
    externalAuthority &&
    (externalAuthority.currentHead.principalId !== input.authorityGroupId ||
      externalAuthority.states.some(
        ({ head }) => head.principalId !== input.authorityGroupId,
      ))
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Authority callback differs from the directory binding",
    );
  assertProjectionVerificationCurrent(stillCurrent);
  const appended = await progress.verifier.append({
    entries,
    signerPublicKeys: keys.signerPublicKeys,
    ...(externalAuthority ? { externalAuthority } : {}),
  });
  if (!appended.ok) throw appended.error;
  const row = {
    id: progress.id,
    organizationId: input.organizationId,
    currentJson: PUBLIC_HISTORY_CURRENT_JSON,
    afterVersion: appended.value.throughVersion - (complete ? 1 : 0),
    complete,
  };
  const sealed = await progress.verifier.exportProgress(
    await principalHistoryStageProtection(
      input.protection,
      input.source.head,
      row,
    ),
  );
  if (!sealed.ok) throw sealed.error;
  const saved = { ...row, progress: sealed.value };
  await savePrincipalHistoryStage({
    execSql: input.execSql,
    stage: saved,
    evidence: await preparePrincipalHistoryEvidencePage({
      scopeId: progress.scopeId,
      organizationId: input.organizationId,
      entries,
      nodes: appended.value.indexNodes,
    }),
    previousProgress: progress.saved?.progress ?? null,
    stillCurrent,
  });
  assertProjectionVerificationCurrent(stillCurrent);
  return {
    ...progress,
    afterVersion: row.afterVersion,
    saved,
    completedHead: complete ? input.source.head : null,
  };
}
