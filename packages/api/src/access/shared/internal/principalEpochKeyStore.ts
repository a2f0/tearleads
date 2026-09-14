import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalEpochKeys } from "@tearleads/api-shared/schema";
import {
  type ManagedRecipientPrincipalType,
  throwPrincipalPolicyValidationError as rejectPrincipalPolicy,
} from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import {
  type PrincipalStateBundleInput,
  principalEpochKeySelect,
  type StoredPrincipalEpochKey,
} from "./principalStateRecords";

interface PrincipalEpochKeyWriteContext {
  readonly executor: DatabaseSession;
  readonly normalizedInput: PrincipalStateBundleInput;
  readonly stateHash: string;
}

async function getPrincipalEpochKeyByEpoch(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  epoch: number,
  executor: DatabaseSession,
): Promise<StoredPrincipalEpochKey | null> {
  const [row] = await executor
    .select(principalEpochKeySelect)
    .from(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, principalType),
        eq(principalEpochKeys.principalId, principalId),
        eq(principalEpochKeys.epoch, epoch),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function insertPrincipalEpochKeyRow(
  input: PrincipalEpochKeyWriteContext,
): Promise<void> {
  await input.executor
    .insert(principalEpochKeys)
    .values({
      principalType: input.normalizedInput.state.principalType,
      principalId: input.normalizedInput.state.principalId,
      epoch: input.normalizedInput.state.keyEpoch,
      introducedByStateHash: input.stateHash,
      encapsulationPublicKey:
        input.normalizedInput.state.encapsulationPublicKey,
      keyFingerprint: input.normalizedInput.state.keyFingerprint,
    })
    .onConflictDoNothing({
      target: [
        principalEpochKeys.principalType,
        principalEpochKeys.principalId,
        principalEpochKeys.epoch,
      ],
    });
}

async function ensureStoredPrincipalEpochKeyMatches(
  input: PrincipalEpochKeyWriteContext,
): Promise<void> {
  const storedEpochKey = await getPrincipalEpochKeyByEpoch(
    input.normalizedInput.state.principalType,
    input.normalizedInput.state.principalId,
    input.normalizedInput.state.keyEpoch,
    input.executor,
  );

  if (!storedEpochKey) {
    throw new Error("Failed to load stored principal epoch key");
  }

  if (
    storedEpochKey.encapsulationPublicKey !==
      input.normalizedInput.state.encapsulationPublicKey ||
    storedEpochKey.keyFingerprint !== input.normalizedInput.state.keyFingerprint
  ) {
    rejectPrincipalPolicy("state_conflict", "Principal epoch key conflict");
  }
}

export async function storePrincipalEpochKeyForState(
  input: PrincipalEpochKeyWriteContext,
): Promise<void> {
  await insertPrincipalEpochKeyRow(input);
  await ensureStoredPrincipalEpochKeyMatches(input);
}
