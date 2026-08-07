import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  principalEpochKeys,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import {
  computePrincipalStateHash,
  type ManagedRecipientPrincipalType,
  throwPrincipalPolicyValidationError as rejectPrincipalPolicy,
  type SignedPrincipalState,
  verifySignedPrincipalState,
} from "@tearleads/crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { firstPerKey, uniqueSortedStrings } from "../../../utils/array";
import {
  normalizePrincipalStateWriteInput,
  type PrincipalStateBundleInput,
  type PrincipalStateExternalSignerAuthorizationInput,
  type PrincipalStateReference,
  principalEpochKeySelect,
  principalProjectionMemberSelect,
  principalStatePayloadSelect,
  principalStateProjectionKey,
  principalStateReferenceKey,
  principalStateSelect,
  projectionMemberKey,
  type StoredPrincipalEpochKey,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
  type StoredPrincipalStateChainEntry,
  type StoredPrincipalStatePayload,
  toStoredPrincipalState,
  toStoredProjectionMember,
} from "./principalStateRecords";
import { loadPrincipalStateSigner } from "./principalStateSigner";
import {
  projectionIncludesAdminUser,
  validatePrincipalPolicyTransition,
  validatePrincipalStateArtifacts,
} from "./principalStateValidation";

export type {
  PrincipalStateBundleInput,
  PrincipalStateExternalSignerAuthorizationInput,
  PrincipalStateReference,
  StoredPrincipalProjectionMember,
  StoredPrincipalState,
} from "./principalStateRecords";
export { principalStateReferenceKey } from "./principalStateRecords";

export interface StoreVerifiedPrincipalStateOptions {
  authorizeExternalAdminSigner?: (
    input: PrincipalStateExternalSignerAuthorizationInput,
  ) => Promise<boolean>;
}

async function getPrincipalStateByVersion(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  version: number,
  executor: DatabaseSession,
): Promise<StoredPrincipalState | null> {
  const [row] = await executor
    .select(principalStateSelect)
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        eq(principalStates.principalId, principalId),
        eq(principalStates.version, version),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return toStoredPrincipalState(row);
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

export async function getPrincipalStatePayloadForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalStatePayload | null> {
  const [row] = await executor
    .select(principalStatePayloadSelect)
    .from(principalStatePayloads)
    .where(
      and(
        eq(principalStatePayloads.principalType, principalType),
        eq(principalStatePayloads.principalId, principalId),
        eq(principalStatePayloads.stateHash, stateHash),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function listProjectionMembersForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalProjectionMember[]> {
  const rows = await executor
    .select(principalProjectionMemberSelect)
    .from(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, principalType),
        eq(principalMembershipProjection.principalId, principalId),
        eq(principalMembershipProjection.stateHash, stateHash),
      ),
    )
    .orderBy(principalMembershipProjection.userId);

  return rows.map(toStoredProjectionMember);
}

export async function getPrincipalStatesForReferences(
  references: readonly PrincipalStateReference[],
  executor: DatabaseSession,
): Promise<Map<string, StoredPrincipalState>> {
  const statesByReference = new Map<string, StoredPrincipalState>();
  const uniqueReferences = new Map(
    references.map((reference) => [
      principalStateReferenceKey(reference),
      reference,
    ]),
  );

  for (const principalType of [
    ...new Set(
      Array.from(uniqueReferences.values()).map(
        (reference) => reference.principalType,
      ),
    ),
  ]) {
    const referencesForType = Array.from(uniqueReferences.values()).filter(
      (reference) => reference.principalType === principalType,
    );
    const principalIds = uniqueSortedStrings(
      referencesForType.map((reference) => reference.principalId),
    );
    const stateHashes = uniqueSortedStrings(
      referencesForType.map((reference) => reference.stateHash),
    );
    const requestedKeys = new Set(
      referencesForType.map(principalStateReferenceKey),
    );

    if (principalIds.length === 0 || stateHashes.length === 0) {
      continue;
    }

    const rows = await executor
      .select(principalStateSelect)
      .from(principalStates)
      .where(
        and(
          eq(principalStates.principalType, principalType),
          inArray(principalStates.principalId, principalIds),
          inArray(principalStates.stateHash, stateHashes),
        ),
      );

    for (const row of rows) {
      const state = toStoredPrincipalState(row);
      const key = principalStateReferenceKey(state);
      if (requestedKeys.has(key)) {
        statesByReference.set(key, state);
      }
    }
  }

  return statesByReference;
}

export async function listPrincipalProjectionMembersForStates(
  principalType: ManagedRecipientPrincipalType,
  states: readonly Pick<StoredPrincipalState, "principalId" | "stateHash">[],
  executor: DatabaseSession,
): Promise<Map<string, StoredPrincipalProjectionMember[]>> {
  const uniquePrincipalIds = uniqueSortedStrings(
    states.map((state) => state.principalId),
  );
  const uniqueStateHashes = uniqueSortedStrings(
    states.map((state) => state.stateHash),
  );
  const requestedKeys = new Set(states.map(principalStateProjectionKey));
  const projectionByState = new Map<
    string,
    StoredPrincipalProjectionMember[]
  >();

  for (const key of requestedKeys) {
    projectionByState.set(key, []);
  }

  if (uniquePrincipalIds.length === 0 || uniqueStateHashes.length === 0) {
    return projectionByState;
  }

  const rows = await executor
    .select(principalProjectionMemberSelect)
    .from(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, principalType),
        inArray(principalMembershipProjection.principalId, uniquePrincipalIds),
        inArray(principalMembershipProjection.stateHash, uniqueStateHashes),
      ),
    )
    .orderBy(
      principalMembershipProjection.principalId,
      principalMembershipProjection.userId,
    );

  for (const row of rows.map(toStoredProjectionMember)) {
    const key = principalStateProjectionKey(row);
    const projection = projectionByState.get(key);

    if (projection) {
      projection.push(row);
    }
  }

  return projectionByState;
}

async function validatePrincipalStateChain(
  state: SignedPrincipalState,
  stateHash: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalState | null> {
  const currentState = await getCurrentPrincipalState(
    state.principalType,
    state.principalId,
    executor,
  );

  if (!currentState) {
    if (state.prevStateHash !== null || state.version !== 1) {
      rejectPrincipalPolicy(
        "state_conflict",
        "Principal state previous hash mismatch",
      );
    }
    return null;
  }

  if (state.version === currentState.version) {
    if (stateHash !== currentState.stateHash) {
      rejectPrincipalPolicy(
        "state_conflict",
        "Principal state version conflict",
      );
    }
    return currentState;
  }

  if (
    state.version !== currentState.version + 1 ||
    state.prevStateHash !== currentState.stateHash
  ) {
    rejectPrincipalPolicy(
      "state_conflict",
      "Principal state previous hash mismatch",
    );
  }

  return currentState;
}

async function validatePrincipalStateSignerAuthorization(input: {
  currentState: StoredPrincipalState | null;
  normalizedInput: PrincipalStateBundleInput;
  options?: StoreVerifiedPrincipalStateOptions | undefined;
  signerUserId: string;
  executor: DatabaseSession;
}): Promise<StoredPrincipalProjectionMember[] | null> {
  if (!input.currentState) {
    if (
      projectionIncludesAdminUser(
        input.normalizedInput.projection,
        input.signerUserId,
      )
    ) {
      if (input.normalizedInput.state.externalAuthority !== null) {
        rejectPrincipalPolicy(
          "unauthorized_signer",
          "Directly authorized principal state cannot cite external authority",
        );
      }
      return null;
    }

    let isExternalAdmin = false;
    if (
      input.normalizedInput.projection.length === 0 &&
      input.normalizedInput.state.externalAuthority !== null &&
      input.options?.authorizeExternalAdminSigner
    ) {
      isExternalAdmin = await input.options.authorizeExternalAdminSigner({
        currentState: null,
        normalizedInput: input.normalizedInput,
        previousProjection: null,
        signerUserId: input.signerUserId,
      });
    }

    if (!isExternalAdmin) {
      rejectPrincipalPolicy(
        "unauthorized_signer",
        "Principal state signer must be an admin",
      );
    }

    return null;
  }

  const previousProjection = await listProjectionMembersForState(
    input.currentState.principalType,
    input.currentState.principalId,
    input.currentState.stateHash,
    input.executor,
  );

  const isDirectAdmin = projectionIncludesAdminUser(
    previousProjection,
    input.signerUserId,
  );
  let isExternalAdmin = false;
  if (isDirectAdmin && input.normalizedInput.state.externalAuthority !== null) {
    rejectPrincipalPolicy(
      "unauthorized_signer",
      "Directly authorized principal state cannot cite external authority",
    );
  }
  if (
    !isDirectAdmin &&
    input.normalizedInput.state.externalAuthority !== null &&
    input.options?.authorizeExternalAdminSigner
  ) {
    isExternalAdmin = await input.options.authorizeExternalAdminSigner({
      currentState: input.currentState,
      normalizedInput: input.normalizedInput,
      previousProjection,
      signerUserId: input.signerUserId,
    });
  }

  if (!isDirectAdmin && !isExternalAdmin) {
    rejectPrincipalPolicy(
      "unauthorized_signer",
      "Principal state signer must be an admin",
    );
  }

  return previousProjection;
}

interface PrincipalStateWriteContext {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  executor: DatabaseSession;
}

async function insertPrincipalStateRow(
  input: PrincipalStateWriteContext,
): Promise<void> {
  await input.executor
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
      payloadCiphertextHash: input.normalizedInput.state.payloadCiphertextHash,
      memberCount: input.normalizedInput.state.memberCount,
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
    });
}

async function ensureStoredPrincipalStateMatches(
  input: PrincipalStateWriteContext,
): Promise<StoredPrincipalState> {
  const storedState = await getPrincipalStateByVersion(
    input.normalizedInput.state.principalType,
    input.normalizedInput.state.principalId,
    input.normalizedInput.state.version,
    input.executor,
  );

  if (!storedState) {
    throw new Error("Failed to load stored principal state");
  }

  if (storedState.stateHash !== input.stateHash) {
    rejectPrincipalPolicy("state_conflict", "Principal state version conflict");
  }

  return storedState;
}

async function insertPrincipalStatePayloadRow(
  input: PrincipalStateWriteContext,
): Promise<void> {
  await input.executor
    .insert(principalStatePayloads)
    .values({
      principalType: input.normalizedInput.state.principalType,
      principalId: input.normalizedInput.state.principalId,
      stateHash: input.stateHash,
      cipherSuite: input.normalizedInput.encryptedPayload.cipherSuite,
      ciphertext: input.normalizedInput.encryptedPayload.ciphertext,
      ciphertextHash: input.normalizedInput.encryptedPayload.ciphertextHash,
    })
    .onConflictDoNothing({
      target: [
        principalStatePayloads.principalType,
        principalStatePayloads.principalId,
        principalStatePayloads.stateHash,
      ],
    });
}

async function ensureStoredPrincipalPayloadMatches(
  input: PrincipalStateWriteContext,
): Promise<void> {
  const storedPayload = await getPrincipalStatePayloadForState(
    input.normalizedInput.state.principalType,
    input.normalizedInput.state.principalId,
    input.stateHash,
    input.executor,
  );
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

async function insertPrincipalEpochKeyRow(
  input: PrincipalStateWriteContext,
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
  input: PrincipalStateWriteContext,
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

  if (
    !(await verifySignedPrincipalState(
      normalizedInput.state,
      signer.signingPublicKey,
    ))
  ) {
    rejectPrincipalPolicy(
      "unauthorized_signer",
      "Invalid principal state signature",
    );
  }

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
      currentState: normalizedInput.state,
      currentProjection: normalizedInput.projection,
      previousProjection,
      previousState: currentState,
    });
  }
  const writeContext: PrincipalStateWriteContext = {
    normalizedInput,
    stateHash,
    executor,
  };

  await insertPrincipalStateRow(writeContext);
  const storedState = await ensureStoredPrincipalStateMatches(writeContext);
  await insertPrincipalStatePayloadRow(writeContext);
  await ensureStoredPrincipalPayloadMatches(writeContext);
  await insertPrincipalProjectionRows(writeContext);
  await ensureStoredPrincipalProjectionMatches(writeContext);
  await insertPrincipalEpochKeyRow(writeContext);
  await ensureStoredPrincipalEpochKeyMatches(writeContext);

  return storedState;
}

export async function getCurrentPrincipalState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalState | null> {
  const [row] = await executor
    .select(principalStateSelect)
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        eq(principalStates.principalId, principalId),
      ),
    )
    .orderBy(desc(principalStates.version))
    .limit(1);

  if (!row) {
    return null;
  }

  return toStoredPrincipalState(row);
}

export async function getCurrentPrincipalStates(
  principalType: ManagedRecipientPrincipalType,
  principalIds: string[],
  executor: DatabaseSession,
): Promise<Map<string, StoredPrincipalState>> {
  const uniquePrincipalIds = uniqueSortedStrings(principalIds);

  if (uniquePrincipalIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select(principalStateSelect)
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        inArray(principalStates.principalId, uniquePrincipalIds),
      ),
    )
    .orderBy(asc(principalStates.principalId), desc(principalStates.version));

  return firstPerKey(rows, (row) => row.principalId, toStoredPrincipalState);
}

export async function listPrincipalStateHistory(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalStateChainEntry[]> {
  const rows = await executor
    .select(principalStateSelect)
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        eq(principalStates.principalId, principalId),
      ),
    )
    .orderBy(asc(principalStates.version));

  const history: StoredPrincipalStateChainEntry[] = [];

  for (const row of rows) {
    const state = toStoredPrincipalState(row);
    history.push({
      state,
      projection: await listProjectionMembersForState(
        principalType,
        principalId,
        state.stateHash,
        executor,
      ),
    });
  }

  return history;
}

export async function listCurrentPrincipalProjectionMembers(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalProjectionMember[]> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    executor,
  );

  if (!currentState) {
    return [];
  }

  return listProjectionMembersForState(
    principalType,
    principalId,
    currentState.stateHash,
    executor,
  );
}

export async function getCurrentPrincipalEpochKey(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: DatabaseSession,
): Promise<StoredPrincipalEpochKey | null> {
  const [row] = await executor
    .select(principalEpochKeySelect)
    .from(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, principalType),
        eq(principalEpochKeys.principalId, principalId),
      ),
    )
    .orderBy(desc(principalEpochKeys.epoch))
    .limit(1);

  return row ?? null;
}

export async function getCurrentPrincipalEpochKeys(
  principalType: ManagedRecipientPrincipalType,
  principalIds: string[],
  executor: DatabaseSession,
): Promise<Map<string, StoredPrincipalEpochKey>> {
  const uniquePrincipalIds = uniqueSortedStrings(principalIds);

  if (uniquePrincipalIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select(principalEpochKeySelect)
    .from(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, principalType),
        inArray(principalEpochKeys.principalId, uniquePrincipalIds),
      ),
    )
    .orderBy(
      asc(principalEpochKeys.principalId),
      desc(principalEpochKeys.epoch),
    );

  return firstPerKey(
    rows,
    (row) => row.principalId,
    (row) => row,
  );
}
