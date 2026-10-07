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
  const mutation = await openPrincipalMutation({
    scope: input.scope,
    row,
    signingPublicKey: input.signingKeyPair.signingPublicKey,
  });
  assertProjectionVerificationCurrent(input.stillCurrent);
  return { row, mutation };
}

/** Inspect authenticated authored work without retrying it or changing checkpoints. */
export async function readJournaledPrincipalMutation(
  input: JournalIdentity,
): Promise<AuthoredPrincipalMutation | null> {
  return runPrincipalMutationJournalOperation(
    input.execSql,
    input.scope,
    async () => (await loadAuthenticatedMutation(input))?.mutation ?? null,
  );
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
