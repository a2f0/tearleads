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
import {
  loadPublicHistoryAuthority,
  publicHistoryAuthorityJson,
  publicHistoryAuthorityReference,
} from "./publicPrincipalHistoryAuthority";
import type {
  PublicPrincipalHistoryOptions,
  PublicPrincipalHistoryProgress,
} from "./publicPrincipalHistoryTypes";

export class PublicPrincipalHistoryPrefixDisconnectedError extends Error {
  constructor(readonly verificationError: KeyingVerificationError) {
    super(verificationError.message);
    this.name = "PublicPrincipalHistoryPrefixDisconnectedError";
  }
}

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
  const references = entries.flatMap(({ state }) =>
    state.externalAuthority ? [state.externalAuthority] : [],
  );
  const externalAuthority = await loadPublicHistoryAuthority(input, references);
  assertProjectionVerificationCurrent(stillCurrent);
  const appended = await progress.verifier.append({
    entries,
    signerPublicKeys: keys.signerPublicKeys,
    ...(externalAuthority ? { externalAuthority } : {}),
  });
  if (!appended.ok) {
    if (appended.error.code === "stale_predecessor")
      throw new PublicPrincipalHistoryPrefixDisconnectedError(appended.error);
    throw appended.error;
  }
  const row = {
    id: progress.id,
    organizationId: input.organizationId,
    currentJson: publicHistoryAuthorityJson(
      publicHistoryAuthorityReference(progress.authorityReference, references),
    ),
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
      indexRootHash: appended.value.indexRootHash,
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
    authorityReference: publicHistoryAuthorityReference(
      progress.authorityReference,
      references,
    ),
    completedHead: complete ? input.source.head : null,
  };
}
