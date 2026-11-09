import {
  createPrincipalPolicyHistoryVerifier,
  KeyingVerificationError,
  type PrincipalPolicyHistoryReferenceProof,
  serializeKeyingCanonicalJson,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import {
  isPrincipalPolicySnapshotPage,
  type PrincipalPolicySnapshotPage,
  type PrincipalStateResponse,
} from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { loadPrincipalHistoryReference } from "../../../data/persistence/principalHistory/principalHistoryEvidencePersistence";
import type { PrincipalHistoryPrefix } from "../../../data/persistence/principalHistory/principalHistoryPrefixPersistence";
import { loadHeldPrincipalState } from "../../../data/persistence/principalPolicy/heldPrincipalState";
import { principalHeadMatchesReference } from "../../../data/principals/organizationAuthorityDescriptor";
import { ownPrincipalHistoryProtection } from "../../../data/principals/principalHistoryProtection";
import { PrincipalPolicyHistoryReadError } from "../historyRecovery/principalHistoryRecoveryTypes";
import {
  type HeldHeadState,
  initialHeldHeadState,
  transitionHeldHeadState,
} from "./heldHeadStateMachine";
import { PublicHistoryAuthorityUnavailableError } from "./publicPrincipalHistoryAuthority";
import {
  appendPublicPrincipalHistoryPage,
  PublicPrincipalHistoryPrefixDisconnectedError,
} from "./publicPrincipalHistoryPage";
import {
  publishPublicPrincipalHistoryPrefix,
  restorePublicPrincipalHistoryProgress,
} from "./publicPrincipalHistoryProgress";
import type {
  PublicPrincipalHistoryOptions,
  PublicPrincipalHistoryProgress,
  RecoveredPublicPrincipalHistory,
} from "./publicPrincipalHistoryTypes";

/** The attempt's held-head machine; written only through its transition. */
interface HeldHeadCell {
  state: HeldHeadState;
}

function assertPage(
  input: PublicPrincipalHistoryOptions,
  page: PrincipalPolicySnapshotPage,
  after: number,
): void {
  if (
    !isPrincipalPolicySnapshotPage(page) ||
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

/**
 * A held copy of the head replaces only its download; the final page appends
 * and checks it exactly as a served state.
 */
async function loadHeldHead(
  input: PublicPrincipalHistoryOptions,
  held: HeldHeadCell,
): Promise<PrincipalStateResponse | undefined> {
  const knownCurrentState =
    held.state.status === "eligible"
      ? ((await loadHeldPrincipalState(input.execSql, input.source.head)) ??
        undefined)
      : undefined;
  held.state = transitionHeldHeadState(held.state, {
    type: knownCurrentState ? "heldLoaded" : "heldMissing",
  });
  return knownCurrentState;
}

async function readPublicPages(
  input: PublicPrincipalHistoryOptions,
  initial: PublicPrincipalHistoryProgress,
  held: HeldHeadCell,
) {
  const current = () => !input.signal?.aborted && input.stillCurrent();
  let progress = initial;
  let lastPage: PrincipalPolicySnapshotPage | undefined;
  // Completed progress already verified every signed entry through the cited
  // head; a read pinned to that head could only repeat it or refuse.
  if (!input.offline && !progress.completedHead) {
    const knownCurrentState = await loadHeldHead(input, held);
    for await (const result of input.historyReader.getProjectionPolicyHistoryPages(
      input.source,
      {
        afterVersion: progress.afterVersion,
        knownCurrentState,
        signal: input.signal,
      },
    )) {
      assertProjectionVerificationCurrent(current);
      if (!result.ok) throw new PrincipalPolicyHistoryReadError(result);
      const page = result.data;
      assertPage(input, page, progress.afterVersion);
      if (progress.completedHead)
        throw new KeyingVerificationError(
          "invalid_shape",
          "Completed public history returned additional entries",
        );
      progress = await appendPublicPrincipalHistoryPage(input, progress, page);
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

function finishPublicProgress(progress: PublicPrincipalHistoryProgress) {
  if (!progress.completedHead)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Completed public history is unavailable",
    );
  const finished = progress.verifier.finish(progress.completedHead);
  if (!finished.ok) throw finished.error;
  return finished.value;
}

/** The last page's current state must extend the same verified history. */
async function verifyLastPageCurrent(
  history: ReturnType<typeof finishPublicProgress>,
  proof: PrincipalPolicyHistoryReferenceProof,
  lastPage: Awaited<ReturnType<typeof readPublicPages>>["lastPage"],
): Promise<void> {
  if (!lastPage) return;
  const currentProof = {
    ...proof,
    entry: {
      state: lastPage.currentState,
      projection: lastPage.currentProjection,
      grants: lastPage.currentGrants,
    },
  };
  const checked = await verifyPrincipalPolicyHistoryReferences({
    history,
    references: [currentProof],
  });
  if (!checked.ok) throw checked.error;
}

// A signed cached candidate need not belong to this requested chain. Only
// reused progress permits one replay; a fresh disconnected chain fails.
function replaysReusedProgress(
  mayReplay: boolean,
  initial: { readonly afterVersion: number },
): boolean {
  return mayReplay && initial.afterVersion > 0;
}

async function recoverAttempt(
  input: PublicPrincipalHistoryOptions,
  allowReuse: boolean,
  rejectedPrefix: PrincipalHistoryPrefix | null,
  held: HeldHeadCell,
): Promise<RecoveredPublicPrincipalHistory> {
  const current = () => !input.signal?.aborted && input.stillCurrent();
  assertProjectionVerificationCurrent(current);
  const mayReplay = allowReuse && !input.offline;
  const initial = await restorePublicPrincipalHistoryProgress(
    input,
    allowReuse,
  );
  let pages: Awaited<ReturnType<typeof readPublicPages>>;
  try {
    pages = await readPublicPages(input, initial, held);
  } catch (error) {
    if (!(error instanceof PublicPrincipalHistoryPrefixDisconnectedError))
      throw error;
    if (replaysReusedProgress(mayReplay, initial))
      return recover(input, false, initial.cachedPrefix);
    throw error.verificationError;
  }
  const { progress, lastPage } = pages;
  const history = finishPublicProgress(progress);
  let proof: PrincipalPolicyHistoryReferenceProof;
  try {
    proof = await loadPrincipalHistoryReference({
      execSql: input.execSql,
      scopeId: progress.scopeId,
      history,
      version: input.source.head.version,
    });
    const selected = await verifyPrincipalPolicyHistoryReferences({
      history,
      references: [proof],
    });
    if (!selected.ok) throw selected.error;
  } catch (error) {
    if (error instanceof KeyingVerificationError && mayReplay)
      return recover(input, false, initial.cachedPrefix);
    throw error;
  }
  // Public prefixes memoize signatures; they are not admitted trust pins. A
  // rejected projection may have left a valid but unrelated signed candidate.
  // Rebuild the requested chain once online; callers still check durable pins
  // and object authority before accepting it. Never reuse a mismatch offline.
  if (!principalHeadMatchesReference(proof.entry.state, input.source.head)) {
    if (mayReplay) return recover(input, false, initial.cachedPrefix);
    throw new KeyingVerificationError(
      "object_mismatch",
      "Public history source differs from the verified prefix",
    );
  }
  await verifyLastPageCurrent(history, proof, lastPage);
  assertProjectionVerificationCurrent(current);
  if (!input.offline)
    await publishPublicPrincipalHistoryPrefix(
      input,
      progress,
      history,
      rejectedPrefix,
    );
  assertProjectionVerificationCurrent(current);
  return { scopeId: progress.scopeId, history };
}

async function recover(
  input: PublicPrincipalHistoryOptions,
  allowReuse = true,
  rejectedPrefix: PrincipalHistoryPrefix | null = null,
  useHeldState = true,
): Promise<RecoveredPublicPrincipalHistory> {
  // A replay distrusts local material, so it reads the served head as well.
  const held: HeldHeadCell = {
    state: initialHeldHeadState(useHeldState && allowReuse),
  };
  try {
    return await recoverAttempt(input, allowReuse, rejectedPrefix, held);
  } catch (error) {
    // A held head copy only saves its download; one the verifier rejects must
    // not block recovery, so read the served copy once instead.
    if (
      held.state.status === "heldSent" &&
      error instanceof KeyingVerificationError
    )
      return recover(input, allowReuse, rejectedPrefix, false);
    if (!(error instanceof PublicHistoryAuthorityUnavailableError)) throw error;
    if (allowReuse && !input.offline)
      return recoverAttempt(input, false, error.rejectedPrefix, {
        state: initialHeldHeadState(false),
      });
    throw error.verificationError;
  }
}

/** Private-key-backed public history recovery; never admits a current policy pin. */
export async function recoverPublicPrincipalHistory(
  options: PublicPrincipalHistoryOptions,
): Promise<RecoveredPublicPrincipalHistory> {
  if (
    !options.organizationId ||
    (options.historicalProof !== undefined &&
      typeof options.historicalProof !== "boolean") ||
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
    "tearleads.sdk.public-principal-history.v2",
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
