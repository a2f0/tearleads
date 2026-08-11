import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalContainerGrantProjection } from "@tearleads/api-shared/schema";
import {
  type ManagedRecipientPrincipalType,
  throwPrincipalPolicyValidationError as rejectPrincipalPolicy,
} from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import type { PrincipalStateBundleInput } from "./principalStateRecords";
import {
  principalContainerGrantSelect,
  type StoredPrincipalContainerGrant,
  toStoredPrincipalContainerGrant,
} from "./principalStateRecords";

export async function listContainerGrantsForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalContainerGrant[]> {
  const rows = await executor
    .select(principalContainerGrantSelect)
    .from(principalContainerGrantProjection)
    .where(
      and(
        eq(principalContainerGrantProjection.principalType, principalType),
        eq(principalContainerGrantProjection.principalId, principalId),
        eq(principalContainerGrantProjection.stateHash, stateHash),
      ),
    )
    .orderBy(principalContainerGrantProjection.containerId);
  return rows.map(toStoredPrincipalContainerGrant);
}

async function insertPrincipalContainerGrantRows(input: {
  readonly executor: DatabaseSession;
  readonly normalizedInput: PrincipalStateBundleInput;
  readonly stateHash: string;
}): Promise<void> {
  if (input.normalizedInput.grants.length === 0) {
    return;
  }
  await input.executor
    .insert(principalContainerGrantProjection)
    .values(
      input.normalizedInput.grants.map((grant) => ({
        principalType: input.normalizedInput.state.principalType,
        principalId: input.normalizedInput.state.principalId,
        stateHash: input.stateHash,
        containerId: grant.containerId,
        accessLevel: grant.accessLevel,
      })),
    )
    .onConflictDoNothing({
      target: [
        principalContainerGrantProjection.principalType,
        principalContainerGrantProjection.principalId,
        principalContainerGrantProjection.stateHash,
        principalContainerGrantProjection.containerId,
      ],
    });
}

async function ensureStoredPrincipalContainerGrantsMatch(input: {
  readonly executor: DatabaseSession;
  readonly normalizedInput: PrincipalStateBundleInput;
  readonly stateHash: string;
}): Promise<void> {
  const stored = await listContainerGrantsForState(
    input.normalizedInput.state.principalType,
    input.normalizedInput.state.principalId,
    input.stateHash,
    input.executor,
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

export async function storePrincipalContainerGrantsForState(input: {
  readonly executor: DatabaseSession;
  readonly normalizedInput: PrincipalStateBundleInput;
  readonly stateHash: string;
}): Promise<void> {
  await insertPrincipalContainerGrantRows(input);
  await ensureStoredPrincipalContainerGrantsMatch(input);
}
