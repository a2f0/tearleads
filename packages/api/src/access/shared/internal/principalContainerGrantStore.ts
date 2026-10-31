import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import {
  type ManagedRecipientPrincipalType,
  normalizePrincipalContainerGrants,
  type PrincipalContainerGrant,
  throwPrincipalPolicyValidationError as rejectPrincipalPolicy,
} from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import {
  type PrincipalStateBundleInput,
  readStoredPrincipalContainerGrants,
} from "./principalStateRecords";

/** The complete grant set stored with one state; none for an unknown state. */
export async function listContainerGrantsForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseSession,
): Promise<PrincipalContainerGrant[]> {
  const [row] = await executor
    .select({ containerGrants: principalStates.containerGrants })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        eq(principalStates.principalId, principalId),
        eq(principalStates.stateHash, stateHash),
      ),
    )
    .limit(1);
  return row ? readStoredPrincipalContainerGrants(row.containerGrants) : [];
}

/**
 * The state row carries its grants from its insert. A replayed state keeps the
 * row it first stored, so its grants must equal the replay's exactly.
 */
export async function ensureStoredPrincipalContainerGrantsMatch(input: {
  readonly executor: DatabaseSession;
  readonly normalizedInput: PrincipalStateBundleInput;
  readonly stateHash: string;
  /** The state row's stored grants when this write inserted it. */
  readonly storedContainerGrants?: unknown;
}): Promise<void> {
  const stored = normalizePrincipalContainerGrants(
    input.storedContainerGrants === undefined
      ? await listContainerGrantsForState(
          input.normalizedInput.state.principalType,
          input.normalizedInput.state.principalId,
          input.stateHash,
          input.executor,
        )
      : readStoredPrincipalContainerGrants(input.storedContainerGrants),
  );
  if (
    stored.length !== input.normalizedInput.grants.length ||
    stored.some((grant, index) => {
      const expected = input.normalizedInput.grants[index];
      return (
        !expected ||
        grant.containerId !== expected.containerId ||
        grant.accessLevel !== expected.accessLevel
      );
    })
  ) {
    rejectPrincipalPolicy(
      "state_conflict",
      "Principal state container grant projection conflict",
    );
  }
}
