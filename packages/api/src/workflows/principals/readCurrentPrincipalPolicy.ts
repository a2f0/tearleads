import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import type { PrincipalPolicyPageQuery } from "@tearleads/validators/operation";
import type { PrincipalPolicyReadResponse } from "@tearleads/validators/response";
import {
  getCurrentPrincipalState,
  getPrincipalStatesForReferences,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import { runPrincipalHistoryTransaction } from "./principalHistoryTransaction";
import { buildPrincipalPolicyPage } from "./principalPolicyPage";
import { assertPrincipalPolicyReadable } from "./principalPolicyReadAuthorization";
import { PrincipalPolicyError } from "./shared";

/**
 * The authenticated HTTP read of one pinned principal policy page. Kept apart from
 * `getCurrentPrincipalPolicy.ts`, which the container writer projection
 * imports while it resolves referenced policies: the authorization here reads
 * container access back through that projection, so folding it in would close
 * an import cycle. Server-side callers that already hold a verified access
 * path use the internal verified policy loaders without this HTTP check.
 */
export async function runReadCurrentPrincipalPolicyWorkflow(
  db: ApiDatabase,
  input: PrincipalPolicyPageQuery & {
    readonly principalId: string;
    readonly principalType: ManagedRecipientPrincipalType;
    readonly requesterUserId: string;
  },
): Promise<PrincipalPolicyReadResponse> {
  const conditional =
    input.ifVersion !== undefined || input.ifStateHash !== undefined;
  if (
    conditional &&
    (input.ifVersion === undefined ||
      input.ifStateHash === undefined ||
      input.stateHash !== undefined ||
      input.afterVersion !== undefined)
  )
    throw new PrincipalPolicyError(
      "A conditional head read names one whole unpinned head",
      400,
    );
  return runPrincipalHistoryTransaction(db, async (tx) => {
    const currentState = await getCurrentPrincipalState(
      input.principalType,
      input.principalId,
      tx,
    );
    if (!currentState) {
      throw new PrincipalPolicyError("Principal policy access denied", 403);
    }
    await assertPrincipalPolicyReadable({
      currentState,
      executor: tx,
      requesterUserId: input.requesterUserId,
    });
    // Authorization always uses the live policy, even when delivery is pinned
    // to an earlier immutable head. A forged current projection cannot grant
    // historical access by borrowing the validity of an older policy.
    await getVerifiedPrincipalPolicyForStateWithExecutor(tx, currentState);
    // A conditional discovery read whose named head is still live gets that
    // head alone, after the same authorization and verification. The client
    // holds and authenticates the artifacts; this reply only proves freshness.
    if (
      input.ifStateHash !== undefined &&
      input.ifVersion === currentState.version &&
      input.ifStateHash === currentState.stateHash
    )
      return {
        unchanged: true as const,
        head: {
          principalType: currentState.principalType,
          principalId: currentState.principalId,
          version: currentState.version,
          stateHash: currentState.stateHash,
          keyEpoch: currentState.keyEpoch,
          keyFingerprint: currentState.keyFingerprint,
        },
      };
    const afterVersion = input.afterVersion ?? 0;
    if (afterVersion > 0 && !input.stateHash)
      throw new PrincipalPolicyError(
        "Principal history cursor requires a pinned head",
        400,
      );
    const reference = {
      ...currentState,
      stateHash: input.stateHash ?? currentState.stateHash,
    };
    const pinned =
      reference.stateHash === currentState.stateHash
        ? currentState
        : (await getPrincipalStatesForReferences([reference], tx)).get(
            principalStateReferenceKey(reference),
          );
    if (!pinned)
      throw new PrincipalPolicyError(
        "Principal history head is unavailable",
        409,
      );
    return buildPrincipalPolicyPage(tx, pinned, afterVersion);
  });
}
