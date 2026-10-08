import { KeyingVerificationError } from "@tearleads/crypto";
import { canonicalKeyingJsonString } from "../../data/keyingCanonicalJson";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import {
  clearPrincipalMutationJournal,
  loadPrincipalMutationJournal,
} from "../../data/persistence/principalMutationJournalPersistence";
import {
  type AuthoredPrincipalMutation,
  openPrincipalMutation,
  principalMutationJournalScopeId,
} from "../../data/principals/principalMutationJournal";
import {
  principalMutationJournalRecordId,
  UnreadablePrincipalMutationError,
} from "../../data/principals/principalMutationJournalRecord";
import { runPrincipalMutationJournalOperation } from "./principalMutationJournalLane";
import type { PrincipalMutationJournalContext } from "./principalMutationJournalSession";

export interface PrincipalMutationRecoveryApi {
  readonly readPendingPrincipalMutation: (
    organizationId: string,
  ) => Promise<AuthoredPrincipalMutation | null>;
  readonly recoverPendingPrincipalMutation: (
    organizationId: string,
  ) => Promise<void>;
  readonly abandonPendingPrincipalMutation: (
    organizationId: string,
    mutation: AuthoredPrincipalMutation,
    acknowledgeUnknownOutcome: true,
  ) => Promise<boolean>;
  readonly discardUnreadablePrincipalMutation: (
    organizationId: string,
    recordId: string,
    acknowledgeUnknownOutcome: true,
  ) => Promise<boolean>;
}

type JournalIdentity = Pick<
  PrincipalMutationJournalContext,
  "execSql" | "scope" | "signingKeyPair" | "stillCurrent"
>;

async function loadAuthenticatedMutation(input: JournalIdentity) {
  assertProjectionVerificationCurrent(input.stillCurrent);
  const row = await loadPrincipalMutationJournal(
    input.execSql,
    await principalMutationJournalScopeId(input.scope),
  );
  assertProjectionVerificationCurrent(input.stillCurrent);
  if (!row) return null;
  let mutation: AuthoredPrincipalMutation;
  try {
    mutation = await openPrincipalMutation({
      scope: input.scope,
      row,
      signingPublicKey: input.signingKeyPair.signingPublicKey,
    });
  } catch (error) {
    assertProjectionVerificationCurrent(input.stillCurrent);
    if (!(error instanceof KeyingVerificationError)) throw error;
    const recordId = await principalMutationJournalRecordId(row);
    assertProjectionVerificationCurrent(input.stillCurrent);
    throw new UnreadablePrincipalMutationError(
      recordId,
      error.code === "invalid_shape" ? "format" : "authentication",
    );
  }
  assertProjectionVerificationCurrent(input.stillCurrent);
  return { row, mutation };
}

/** Discard only the inspected unreadable bytes; never parse them for submission. */
export async function discardUnreadableJournaledPrincipalMutation(
  input: JournalIdentity & {
    readonly recordId: string;
    readonly acknowledgeUnknownOutcome: true;
  },
): Promise<boolean> {
  if (input.acknowledgeUnknownOutcome !== true)
    throw new Error(
      "Discarding unreadable work requires acknowledging its unknown outcome",
    );
  const expected = input.recordId;
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
      if (!row) return false;
      if ((await principalMutationJournalRecordId(row)) !== expected)
        throw new Error(
          "The unreadable principal mutation changed after inspection",
        );
      let unreadable = false;
      try {
        await openPrincipalMutation({
          scope: input.scope,
          row,
          signingPublicKey: input.signingKeyPair.signingPublicKey,
        });
      } catch (error) {
        if (!(error instanceof KeyingVerificationError)) throw error;
        unreadable = true;
      }
      if (!unreadable)
        throw new Error(
          "Readable principal mutations require ordinary abandonment",
        );
      const removed = await clearPrincipalMutationJournal({
        execSql: input.execSql,
        row,
        stillCurrent: input.stillCurrent,
      });
      assertProjectionVerificationCurrent(input.stillCurrent);
      if (!removed)
        throw new Error(
          "The unreadable principal mutation changed during discard",
        );
      return true;
    },
  );
}

/** Inspect authenticated authored work without retrying it or changing checkpoints. */
export async function readJournaledPrincipalMutation(
  input: JournalIdentity,
): Promise<AuthoredPrincipalMutation | null> {
  // Inspection may observe an owned dispatch; all mutations still use the lane.
  return (await loadAuthenticatedMutation(input))?.mutation ?? null;
}

/**
 * An explicit host/user choice to stop retries, not a claim that the write failed.
 * The exact inspected request must still own the lane; ordinary recovery never
 * calls this. Future authoring must still verify the latest policy state.
 */
export async function abandonJournaledPrincipalMutation(
  input: JournalIdentity & {
    readonly mutation: AuthoredPrincipalMutation;
    readonly acknowledgeUnknownOutcome: true;
  },
): Promise<boolean> {
  if (input.acknowledgeUnknownOutcome !== true)
    throw new Error(
      "Abandoning authored work requires acknowledging its unknown outcome",
    );
  const expected = canonicalKeyingJsonString(
    JSON.parse(JSON.stringify(input.mutation)),
    "inspected authored mutation",
  );
  return runPrincipalMutationJournalOperation(
    input.execSql,
    input.scope,
    async () => {
      const saved = await loadAuthenticatedMutation(input);
      if (!saved) return false;
      if (
        canonicalKeyingJsonString(saved.mutation, "saved authored mutation") !==
        expected
      )
        throw new Error(
          "The pending principal mutation changed after inspection",
        );
      const removed = await clearPrincipalMutationJournal({
        execSql: input.execSql,
        row: saved.row,
        stillCurrent: input.stillCurrent,
      });
      assertProjectionVerificationCurrent(input.stillCurrent);
      if (!removed)
        throw new Error(
          "The pending principal mutation changed during abandonment",
        );
      return true;
    },
  );
}
