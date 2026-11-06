import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  throwPrincipalPolicyValidationError as rejectPrincipalPolicy,
  type SignedPrincipalState,
} from "@tearleads/crypto";
import { listProjectionMembersForState } from "./principalProjectionStore";
import { authorizePrincipalStateSigner } from "./principalSignerAuthority";
import { getCurrentPrincipalState } from "./principalStateReads";
import type {
  PrincipalStateBundleInput,
  PrincipalStateExternalSignerAuthorizationInput,
  StoredPrincipalProjectionMember,
  StoredPrincipalState,
} from "./principalStateRecords";
import { projectionIncludesAdminUser } from "./principalStateValidation";

export interface StoreVerifiedPrincipalStateOptions {
  authorizeExternalAdminSigner?: (
    input: PrincipalStateExternalSignerAuthorizationInput,
  ) => Promise<boolean>;
}

export async function validatePrincipalStateChain(
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
    if (state.keyEpoch !== 1) {
      rejectPrincipalPolicy(
        "state_conflict",
        "Initial principal policy key epoch must be 1",
      );
    }
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

export async function validatePrincipalStateSignerAuthorization(input: {
  currentState: StoredPrincipalState | null;
  normalizedInput: PrincipalStateBundleInput;
  options?: StoreVerifiedPrincipalStateOptions | undefined;
  signerUserId: string;
  executor: DatabaseSession;
}): Promise<StoredPrincipalProjectionMember[] | null> {
  const { currentState, normalizedInput, signerUserId } = input;
  const authorizeExternalAdminSigner =
    input.options?.authorizeExternalAdminSigner;
  const citesExternalAuthority =
    normalizedInput.state.externalAuthority !== null;
  if (!currentState) {
    // An initial state is governed by its own projection; external authority
    // may only vouch for one that names no members.
    await authorizePrincipalStateSigner({
      isDirectAdmin: projectionIncludesAdminUser(
        normalizedInput.projection,
        signerUserId,
      ),
      citesExternalAuthority,
      mayUseExternalAuthority: normalizedInput.projection.length === 0,
      authorizeExternalAdmin:
        authorizeExternalAdminSigner &&
        (() =>
          authorizeExternalAdminSigner({
            currentState: null,
            normalizedInput,
            previousProjection: null,
            signerUserId,
          })),
    });
    return null;
  }

  const previousProjection = await listProjectionMembersForState(
    currentState.principalType,
    currentState.principalId,
    currentState.stateHash,
    input.executor,
  );
  await authorizePrincipalStateSigner({
    isDirectAdmin: projectionIncludesAdminUser(
      previousProjection,
      signerUserId,
    ),
    citesExternalAuthority,
    mayUseExternalAuthority: true,
    authorizeExternalAdmin:
      authorizeExternalAdminSigner &&
      (() =>
        authorizeExternalAdminSigner({
          currentState,
          normalizedInput,
          previousProjection,
          signerUserId,
        })),
  });
  return previousProjection;
}
