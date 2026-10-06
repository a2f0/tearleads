import {
  createPrincipalPolicyHistoryVerifier,
  KeyingVerificationError,
  type PrincipalPolicyHistoryReferenceProof,
  serializeKeyingCanonicalJson,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import {
  isPrincipalPolicySnapshotPageResponse,
  type PrincipalPolicySnapshotPageResponse,
} from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalHistoryReference } from "../../data/persistence/principalHistoryEvidencePersistence";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import { ownPrincipalHistoryProtection } from "../../data/principals/principalHistoryProtection";
import { PrincipalPolicyHistoryReadError } from "./principalHistoryRecoveryTypes";
import { appendPublicPrincipalHistoryPage } from "./publicPrincipalHistoryPage";
import {
  publishPublicPrincipalHistoryPrefix,
  restorePublicPrincipalHistoryProgress,
} from "./publicPrincipalHistoryProgress";
import type {
  PublicPrincipalHistoryOptions,
  PublicPrincipalHistoryProgress,
  RecoveredPublicPrincipalHistory,
} from "./publicPrincipalHistoryTypes";

function assertPage(
  input: PublicPrincipalHistoryOptions,
  page: PrincipalPolicySnapshotPageResponse,
  after: number,
): void {
  if (
    !isPrincipalPolicySnapshotPageResponse(page) ||
    !principalHeadMatchesReference(page.currentState, input.source.head) ||
    page.historyPage.afterVersion !== after
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Public history page does not match its requested head and cursor",
    );
  const through = after + page.previousStates.length;
  if (
    page.previousStates.some(
      ({ state }, index) => state.version !== after + index + 1,
    ) ||
    through >= input.source.head.version ||
    (page.historyPage.nextAfterVersion === null
      ? through !== input.source.head.version - 1
      : through <= after || page.historyPage.nextAfterVersion !== through)
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Public history page has a gap or invalid continuation",
    );
}

async function readPublicPages(
  input: PublicPrincipalHistoryOptions,
  initial: PublicPrincipalHistoryProgress,
) {
  const current = () => !input.signal?.aborted && input.stillCurrent();
  let progress = initial;
  let lastPage: PrincipalPolicySnapshotPageResponse | undefined;
  if (!input.offline) {
    for await (const result of input.apiClient.getProjectionPolicyHistoryPages(
      input.source,
      { afterVersion: progress.afterVersion, signal: input.signal },
    )) {
      assertProjectionVerificationCurrent(current);
      if (!result.ok) throw new PrincipalPolicyHistoryReadError(result);
      const page = result.data;
      assertPage(input, page, progress.afterVersion);
      if (!progress.completedHead)
        progress = await appendPublicPrincipalHistoryPage(
          input,
          progress,
          page,
        );
      else if (
        page.previousStates.length ||
        page.historyPage.nextAfterVersion !== null
      )
        throw new KeyingVerificationError(
          "invalid_shape",
          "Completed public history returned additional entries",
        );
      lastPage = page;
    }
    if (lastPage?.historyPage.nextAfterVersion !== null)
      throw new KeyingVerificationError(
        "missing_dependency",
        "Public history transport did not complete",
      );
  }
  return { progress, lastPage };
}

async function recover(
  input: PublicPrincipalHistoryOptions,
  allowReuse = true,
): Promise<RecoveredPublicPrincipalHistory> {
  const current = () => !input.signal?.aborted && input.stillCurrent();
  assertProjectionVerificationCurrent(current);
  const { progress, lastPage } = await readPublicPages(
    input,
    await restorePublicPrincipalHistoryProgress(input, allowReuse),
  );
  if (!progress.completedHead)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Completed public history is unavailable",
    );
  const finished = progress.verifier.finish(progress.completedHead);
  if (!finished.ok) throw finished.error;
  let proof: PrincipalPolicyHistoryReferenceProof;
  try {
    proof = await loadPrincipalHistoryReference({
      execSql: input.execSql,
      scopeId: progress.scopeId,
      history: finished.value,
      version: input.source.head.version,
    });
    const selected = await verifyPrincipalPolicyHistoryReferences({
      history: finished.value,
      references: [proof],
    });
    if (!selected.ok) throw selected.error;
  } catch (error) {
    if (
      error instanceof KeyingVerificationError &&
      allowReuse &&
      !input.offline
    )
      return recover(input, false);
    throw error;
  }
  // Authenticate stored bytes before comparing a caller's pin. A bad citation
  // or changed server artifact is terminal, never a reason to trust another head.
  if (!principalHeadMatchesReference(proof.entry.state, input.source.head))
    throw new KeyingVerificationError(
      "object_mismatch",
      "Public history source differs from the verified prefix",
    );
  if (lastPage) {
    const currentProof = {
      ...proof,
      entry: {
        state: lastPage.currentState,
        projection: lastPage.currentProjection,
        grants: lastPage.currentGrants,
      },
    };
    const checked = await verifyPrincipalPolicyHistoryReferences({
      history: finished.value,
      references: [currentProof],
    });
    if (!checked.ok) throw checked.error;
  }
  assertProjectionVerificationCurrent(current);
  if (!input.offline)
    await publishPublicPrincipalHistoryPrefix(input, progress, finished.value);
  assertProjectionVerificationCurrent(current);
  return { scopeId: progress.scopeId, history: finished.value };
}

/** Private-key-backed public history recovery; never admits a current policy pin. */
export async function recoverPublicPrincipalHistory(
  options: PublicPrincipalHistoryOptions,
): Promise<RecoveredPublicPrincipalHistory> {
  if (
    !options.organizationId ||
    (options.offline !== undefined && typeof options.offline !== "boolean") ||
    (options.strictAdmins !== undefined &&
      typeof options.strictAdmins !== "boolean") ||
    (options.strictAdmins &&
      (options.source.head.principalType !== "group" ||
        options.loadExternalAuthority))
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Invalid public history verification scope",
    );
  if (
    options.source.head.principalType === "organization" &&
    options.source.head.principalId !== options.organizationId
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Public organization history is outside its scope",
    );
  // Validate the caller's pinned head before any cache or transport access.
  createPrincipalPolicyHistoryVerifier({
    principalType: options.source.head.principalType,
    principalId: options.source.head.principalId,
    retainedReferences: [options.source.head],
  });
  const protection = ownPrincipalHistoryProtection(options.protection);
  protection.context = serializeKeyingCanonicalJson([
    "tearleads.sdk.public-principal-history.v1",
    protection.context,
    options.strictAdmins === true,
    options.authorityGroupId ?? null,
  ]);
  const input = {
    ...options,
    source: structuredClone(options.source),
    protection,
  };
  try {
    return await recover(input, options.replay !== true);
  } finally {
    protection.localKey.fill(0);
  }
}
