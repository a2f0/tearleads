import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  throwPrincipalPolicyValidationError as rejectPrincipalPolicy,
  type SignedPrincipalState,
} from "@tearleads/crypto";
import { listProjectionMembersForState } from "./principalProjectionStore";
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
