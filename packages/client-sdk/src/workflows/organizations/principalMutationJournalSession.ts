import type { RequestResult } from "@tearleads/api-client";
import type { SigningKeyPair } from "@tearleads/crypto";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import {
  claimPrincipalMutationJournal,
  clearPrincipalMutationJournal,
  loadPrincipalMutationJournal,
  type PrincipalMutationJournalRow,
} from "../../data/persistence/principalMutationJournalPersistence";
import {
  type AuthoredPrincipalMutation,
  openPrincipalMutation,
  type PrincipalMutationJournalScope,
  principalMutationJournalScopeId,
  sealPrincipalMutation,
} from "../../data/principals/principalMutationJournal";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { runPrincipalMutationJournalOperation } from "./principalMutationJournalLane";
import { assertAuthoredPrincipalMutationReceipt } from "./principalMutationReceipt";

type MutationResult = RequestResult<CommitOrganizationGroupPolicyResponse>;

export interface PrincipalMutationJournalContext {
  readonly execSql: ExecSql;
  readonly scope: PrincipalMutationJournalScope;
  readonly signingKeyPair: SigningKeyPair;
  readonly stillCurrent: () => boolean;
  readonly submit: (
    mutation: AuthoredPrincipalMutation,
  ) => Promise<MutationResult>;
}

export class PrincipalMutationOutcomeUnknownError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "A saved policy request may have committed; resolve its outcome or explicitly abandon its retry before another mutation",
      options,
    );
    this.name = "PrincipalMutationOutcomeUnknownError";
  }
}

function knownInitialRefusal(result: MutationResult): boolean {
  if (result.ok) return false;
  // ApiClient separates pre-dispatch cancellation from an uncertain sent write.
  if (result.kind === "cancelled") return true;
  if (result.kind !== "http") return false;
  return (
    [400, 401, 402, 403, 404, 409].includes(result.status ?? 0) ||
    (result.status === 503 &&
      result.code === "principal_history_preparation_unavailable")
  );
}

async function submitSavedMutation(
  input: PrincipalMutationJournalContext,
  row: PrincipalMutationJournalRow,
  recovering: boolean,
): Promise<{ mutation: AuthoredPrincipalMutation; result: MutationResult }> {
  const mutation = await openPrincipalMutation({
    scope: input.scope,
    row,
    signingPublicKey: input.signingKeyPair.signingPublicKey,
  });
  assertProjectionVerificationCurrent(input.stillCurrent);
  // Keep the authenticated copy for acknowledgement checks even if a transport
  // mutates its argument while preparing or retrying the HTTP request.
  let result: MutationResult;
  try {
    result = await input.submit(structuredClone(mutation));
  } catch (cause) {
    assertProjectionVerificationCurrent(input.stillCurrent);
    throw new PrincipalMutationOutcomeUnknownError({ cause });
  }
  assertProjectionVerificationCurrent(input.stillCurrent);
  if (result.ok) {
    await assertAuthoredPrincipalMutationReceipt(mutation.request, result.data);
  } else if (recovering || !knownInitialRefusal(result)) {
    // A refusal today (including loss of admin access) cannot establish whether
    // an earlier disconnected attempt committed. Preserve the original intent.
    throw new PrincipalMutationOutcomeUnknownError();
  }
  await clearPrincipalMutationJournal({
    execSql: input.execSql,
    row,
    stillCurrent: input.stillCurrent,
  });
  assertProjectionVerificationCurrent(input.stillCurrent);
  return { mutation, result };
}

/** No HTTP begins until the exact authored request is durably claimed. */
export async function submitJournaledPrincipalMutation(
  input: PrincipalMutationJournalContext & {
    readonly mutation: AuthoredPrincipalMutation;
  },
): Promise<MutationResult> {
  return runPrincipalMutationJournalOperation(
    input.execSql,
    input.scope,
    async () => {
      assertProjectionVerificationCurrent(input.stillCurrent);
      const row = await sealPrincipalMutation(input);
      await claimPrincipalMutationJournal({
        execSql: input.execSql,
        row,
        stillCurrent: input.stillCurrent,
      });
      return (await submitSavedMutation(input, row, false)).result;
    },
  );
}

/** Retry only authenticated saved bytes, never an application mutation callback. */
export async function recoverJournaledPrincipalMutation(
  input: PrincipalMutationJournalContext,
): Promise<{
  readonly mutation: AuthoredPrincipalMutation;
  readonly response: CommitOrganizationGroupPolicyResponse;
} | null> {
  return runPrincipalMutationJournalOperation(
    input.execSql,
    input.scope,
    async () => {
      assertProjectionVerificationCurrent(input.stillCurrent);
      const row = await loadPrincipalMutationJournal(
        input.execSql,
        await principalMutationJournalScopeId(input.scope),
      );
      assertProjectionVerificationCurrent(input.stillCurrent);
      if (!row) return null;
      const { mutation, result } = await submitSavedMutation(input, row, true);
      if (!result.ok) throw new PrincipalMutationOutcomeUnknownError();
      return { mutation, response: result.data };
    },
  );
}
