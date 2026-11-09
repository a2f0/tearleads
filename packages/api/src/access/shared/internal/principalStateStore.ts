import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import {
  computePrincipalStateHash,
  throwPrincipalPolicyValidationError as rejectPrincipalPolicy,
} from "@tearleads/crypto";
import {
  ensureStoredPrincipalContainerGrantsMatch,
  listContainerGrantsForState,
} from "./principalContainerGrantStore";
import { listProjectionMembersForState } from "./principalProjectionStore";
import {
  getPrincipalStateByVersion,
  getPrincipalStatePayloadForState,
} from "./principalStateReads";
import {
  normalizePrincipalStateWriteInput,
  type PrincipalStateBundleInput,
  principalStatePayloadSelect,
  principalStateSelect,
  projectionMemberKey,
  type StoredPrincipalState,
  type StoredPrincipalStatePayload,
  toStoredPrincipalState,
} from "./principalStateRecords";
import {
  assertSignedPrincipalStateVerified,
  assertStoredPrincipalStateVerbatim,
} from "./principalStateSignature";
import { loadPrincipalStateSigner } from "./principalStateSigner";
import {
  type StoreVerifiedPrincipalStateOptions,
  validatePrincipalStateChain,
  validatePrincipalStateSignerAuthorization,
} from "./principalStateSuccession";
import {
  validatePrincipalPolicyTransition,
  validatePrincipalStateArtifacts,
} from "./principalStateValidation";
import { forgetCurrentPrincipalStates } from "./principalTransactionMemo";

interface PrincipalStateWriteContext {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  executor: DatabaseSession;
}

/** The inserted row and its grants, or null when the version already exists. */
async function insertPrincipalStateRow(input: PrincipalStateWriteContext) {
  const [inserted] = await input.executor
    .insert(principalStates)
    .values({
      principalType: input.normalizedInput.state.principalType,
      principalId: input.normalizedInput.state.principalId,
      version: input.normalizedInput.state.version,
      prevStateHash: input.normalizedInput.state.prevStateHash,
      keyEpoch: input.normalizedInput.state.keyEpoch,
      encapsulationPublicKey:
        input.normalizedInput.state.encapsulationPublicKey,
      keyFingerprint: input.normalizedInput.state.keyFingerprint,
      membershipMode: input.normalizedInput.state.membershipMode,
      membershipRoot: input.normalizedInput.state.membershipRoot,
      memberEnvelopesRoot: input.normalizedInput.state.memberEnvelopesRoot,
      projectionRoot: input.normalizedInput.state.projectionRoot,
      grantRoot: input.normalizedInput.state.grantRoot,
      payloadCiphertextHash: input.normalizedInput.state.payloadCiphertextHash,
      memberCount: input.normalizedInput.state.memberCount,
      grantCount: input.normalizedInput.state.grantCount,
      containerGrants: input.normalizedInput.grants,
      externalAuthority: input.normalizedInput.state.externalAuthority,
      stateHash: input.stateHash,
      signedAt: new Date(input.normalizedInput.state.signedAt),
      signerUserId: input.normalizedInput.state.signerUserId,
      signerUserKeyFingerprint:
        input.normalizedInput.state.signerUserKeyFingerprint,
      signature: input.normalizedInput.state.signature,
    })
    .onConflictDoNothing({
      target: [
        principalStates.principalType,
        principalStates.principalId,
        principalStates.version,
      ],
    })
    .returning({
      ...principalStateSelect,
      containerGrants: principalStates.containerGrants,
    });
  forgetCurrentPrincipalStates(input.executor);
  if (!inserted) return null;
  const { containerGrants, ...row } = inserted;
  return { containerGrants, state: toStoredPrincipalState(row) };
}

/**
 * Compares the representation readers reconstruct: the RETURNING row of a
 * fresh insert, or the stored row when the version already existed.
 */
async function ensureStoredPrincipalStateMatches(
  input: PrincipalStateWriteContext,
  inserted: StoredPrincipalState | null,
): Promise<StoredPrincipalState> {
  const storedState =
    inserted ??
    (await getPrincipalStateByVersion(
      input.normalizedInput.state.principalType,
      input.normalizedInput.state.principalId,
      input.normalizedInput.state.version,
      input.executor,
    ));

  if (!storedState) {
    throw new Error("Failed to load stored principal state");
  }

  if (storedState.stateHash !== input.stateHash) {
    rejectPrincipalPolicy("state_conflict", "Principal state version conflict");
  }
  await assertStoredPrincipalStateVerbatim(
    storedState,
    input.normalizedInput.state,
    input.stateHash,
  );

  return storedState;
}

/**
 * The payload shares its state's insertion time: a write acknowledges both by
 * one `createdAt`, and some backends evaluate each column default separately.
 */
async function insertPrincipalStatePayloadRow(
  input: PrincipalStateWriteContext,
  createdAt: Date,
): Promise<StoredPrincipalStatePayload | null> {
  const [inserted] = await input.executor
    .insert(principalStatePayloads)
    .values({
      principalType: input.normalizedInput.state.principalType,
      principalId: input.normalizedInput.state.principalId,
      stateHash: input.stateHash,
      cipherSuite: input.normalizedInput.encryptedPayload.cipherSuite,
      ciphertext: input.normalizedInput.encryptedPayload.ciphertext,
      ciphertextHash: input.normalizedInput.encryptedPayload.ciphertextHash,
      createdAt,
    })
    .onConflictDoNothing({
      target: [
        principalStatePayloads.principalType,
        principalStatePayloads.principalId,
        principalStatePayloads.stateHash,
      ],
    })
    .returning(principalStatePayloadSelect);
  return inserted ?? null;
}

async function ensureStoredPrincipalPayloadMatches(
  input: PrincipalStateWriteContext,
  inserted: StoredPrincipalStatePayload | null,
): Promise<void> {
  const storedPayload =
    inserted ??
    (await getPrincipalStatePayloadForState(
      input.normalizedInput.state.principalType,
      input.normalizedInput.state.principalId,
      input.stateHash,
      input.executor,
    ));
  if (!storedPayload) {
    throw new Error("Failed to load stored principal state payload");
  }
  if (
    storedPayload.cipherSuite !==
      input.normalizedInput.encryptedPayload.cipherSuite ||
    storedPayload.ciphertext !==
      input.normalizedInput.encryptedPayload.ciphertext ||
    storedPayload.ciphertextHash !==
      input.normalizedInput.encryptedPayload.ciphertextHash
  ) {
    rejectPrincipalPolicy("state_conflict", "Principal state payload conflict");
  }
}

async function insertPrincipalProjectionRows(
  input: PrincipalStateWriteContext,
): Promise<void> {
  if (input.normalizedInput.projection.length === 0) {
    return;
  }

  await input.executor
    .insert(principalMembershipProjection)
    .values(
      input.normalizedInput.projection.map((member) => ({
        principalType: input.normalizedInput.state.principalType,
        principalId: input.normalizedInput.state.principalId,
        stateHash: input.stateHash,
        userId: member.userId,
        role: member.role,
      })),
    )
    .onConflictDoNothing({
      target: [
        principalMembershipProjection.principalType,
        principalMembershipProjection.principalId,
        principalMembershipProjection.stateHash,
        principalMembershipProjection.userId,
      ],
    });
}

async function ensureStoredPrincipalProjectionMatches(
  input: PrincipalStateWriteContext,
): Promise<void> {
  const storedProjection = await listProjectionMembersForState(
    input.normalizedInput.state.principalType,
    input.normalizedInput.state.principalId,
    input.stateHash,
    input.executor,
  );

  if (storedProjection.length !== input.normalizedInput.projection.length) {
    rejectPrincipalPolicy(
      "state_conflict",
      "Principal state projection conflict",
    );
  }

  const storedProjectionKeys = new Set(
    storedProjection.map((member) => projectionMemberKey(member)),
  );
  for (const member of input.normalizedInput.projection) {
    if (!storedProjectionKeys.has(projectionMemberKey(member))) {
      rejectPrincipalPolicy(
        "state_conflict",
        "Principal state projection conflict",
      );
    }
  }
}

export async function storeVerifiedPrincipalStateInTransaction(
  input: PrincipalStateBundleInput,
  executor: DatabaseTransaction,
  options?: StoreVerifiedPrincipalStateOptions,
): Promise<StoredPrincipalState> {
  const normalizedInput = normalizePrincipalStateWriteInput(input);
  const signer = await loadPrincipalStateSigner(
    normalizedInput.state,
    executor,
  );

  await assertSignedPrincipalStateVerified(
    normalizedInput.state,
    signer.signingPublicKey,
  );

  await validatePrincipalStateArtifacts(normalizedInput);

  const stateHash = await computePrincipalStateHash(normalizedInput.state);
  const currentState = await validatePrincipalStateChain(
    normalizedInput.state,
    stateHash,
    executor,
  );
  // Chain validation accepts an equal version only for the identical state
  // hash. Such a replay cannot change authority and remains valid after signer
  // removal; only a new successor requires current-admin authorization.
  const isExactReplay = currentState?.version === normalizedInput.state.version;
  const previousProjection = isExactReplay
    ? null
    : await validatePrincipalStateSignerAuthorization({
        currentState,
        normalizedInput,
        options,
        signerUserId: signer.userId,
        executor,
      });
  if (currentState && normalizedInput.state.version > currentState.version) {
    validatePrincipalPolicyTransition({
      currentGrants: normalizedInput.grants,
      currentState: normalizedInput.state,
      currentProjection: normalizedInput.projection,
      previousGrants: await listContainerGrantsForState(
        currentState.principalType,
        currentState.principalId,
        currentState.stateHash,
        executor,
      ),
      previousProjection,
      previousState: currentState,
    });
  }
  const writeContext: PrincipalStateWriteContext = {
    normalizedInput,
    stateHash,
    executor,
  };

  // Each insert returns the stored representation when it creates the row;
  // only an existing row (a replay or a conflict) is read back.
  const insertedState = await insertPrincipalStateRow(writeContext);
  const storedState = await ensureStoredPrincipalStateMatches(
    writeContext,
    insertedState?.state ?? null,
  );
  await ensureStoredPrincipalPayloadMatches(
    writeContext,
    await insertPrincipalStatePayloadRow(writeContext, storedState.createdAt),
  );
  await insertPrincipalProjectionRows(writeContext);
  await ensureStoredPrincipalProjectionMatches(writeContext);
  await ensureStoredPrincipalContainerGrantsMatch({
    ...writeContext,
    storedContainerGrants: insertedState?.containerGrants,
  });

  return storedState;
}
