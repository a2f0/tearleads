import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  type PrincipalPolicyExternalAuthority,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { loadSignerPublicKey } from "../signerPublicKey";
import { buildPrincipalPolicyForStateWithExecutor } from "./principalPolicyBundleRecords";
import { PrincipalPolicyError } from "./shared";

function principalPolicyReference(
  state: Pick<
    ReferencedPrincipalHead,
    | "principalType"
    | "principalId"
    | "version"
    | "keyEpoch"
    | "stateHash"
    | "keyFingerprint"
  >,
): ReferencedPrincipalHead {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
}

function principalPolicyStates(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

async function loadPolicySignerPublicKeys(
  executor: DatabaseSession,
  bundle: PrincipalPolicyBundleResponse,
): Promise<PrincipalPolicySignerPublicKey[]> {
  const keys = new Map<string, PrincipalPolicySignerPublicKey>();
  for (const state of principalPolicyStates(bundle)) {
    const key = `${state.signerUserId}:${state.signerUserKeyFingerprint}`;
    if (keys.has(key)) {
      continue;
    }
    const signingPublicKey = await loadSignerPublicKey(executor, {
      error: () =>
        new PrincipalPolicyError(
          "Stored principal policy signer is missing or inconsistent",
          409,
        ),
      fingerprint: state.signerUserKeyFingerprint,
      userId: state.signerUserId,
    });
    keys.set(key, {
      userId: state.signerUserId,
      signingKeyFingerprint: state.signerUserKeyFingerprint,
      signingPublicKey,
    });
  }
  return [...keys.values()];
}

function assertReservedAdminsPolicyShape(
  policy: VerifiedPrincipalPolicy,
): void {
  const history = policy.history ?? [
    { state: policy.state, projection: policy.projection },
  ];
  if (
    history.some(
      (entry) =>
        entry.projection.length === 0 ||
        entry.projection.some((member) => member.role !== "admin"),
    )
  ) {
    throw new PrincipalPolicyError(
      "Stored external admin policy has an invalid projection",
      409,
    );
  }
}

function externalAuthorityFromPolicy(
  policy: VerifiedPrincipalPolicy,
): PrincipalPolicyExternalAuthority {
  const history = policy.history ?? [
    { state: policy.state, projection: policy.projection },
  ];
  const toAuthorityHead = (
    state: (typeof history)[number]["state"],
  ): PrincipalPolicyExternalAuthority["currentHead"] => {
    if (state.principalType !== "group") {
      throw new PrincipalPolicyError(
        "Stored external authority is not a group policy",
        409,
      );
    }
    return {
      principalType: "group",
      principalId: state.principalId,
      version: state.version,
      keyEpoch: state.keyEpoch,
      stateHash: state.stateHash,
      keyFingerprint: state.keyFingerprint,
    };
  };
  return {
    currentHead: toAuthorityHead(policy.state),
    states: history.map((entry) => ({
      head: toAuthorityHead(entry.state),
      projection: entry.projection,
    })),
  };
}

function externalAuthorityPrincipalId(
  bundle: PrincipalPolicyBundleResponse,
): string | null {
  const authorities = principalPolicyStates(bundle).flatMap((state) =>
    state.externalAuthority ? [state.externalAuthority] : [],
  );
  if (authorities.length === 0) {
    return null;
  }
  const [first] = authorities;
  if (
    !first ||
    first.principalType !== "group" ||
    authorities.some(
      (authority) =>
        authority.principalType !== "group" ||
        authority.principalId !== first.principalId,
    )
  ) {
    throw new PrincipalPolicyError(
      "Stored principal policy cites inconsistent external authority",
      409,
    );
  }
  return first.principalId;
}

function integrityFailure(
  label: string,
  message: string,
): PrincipalPolicyError {
  return new PrincipalPolicyError(`${label}: ${message}`, 409);
}

export async function verifyStoredPrincipalPolicyBundle(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly executor: DatabaseSession;
}): Promise<VerifiedPrincipalPolicy> {
  const signerPublicKeys = await loadPolicySignerPublicKeys(
    input.executor,
    input.bundle,
  );
  const expectedReference = principalPolicyReference(input.bundle.currentState);
  const directVerification = await verifyPrincipalPolicyBundle({
    bundle: input.bundle,
    expectedReference,
    localCheckpoint: null,
    signerPublicKeys,
  });
  if (directVerification.ok) {
    return directVerification.value;
  }
  if (directVerification.error.code !== "unauthorized") {
    throw integrityFailure(
      "Stored principal policy failed integrity verification",
      directVerification.error.message,
    );
  }

  const authorityPrincipalId = externalAuthorityPrincipalId(input.bundle);
  if (
    !authorityPrincipalId ||
    (input.bundle.currentState.principalType === "group" &&
      input.bundle.currentState.principalId === authorityPrincipalId)
  ) {
    throw integrityFailure(
      "Stored principal policy failed integrity verification",
      directVerification.error.message,
    );
  }
  const authorityState = await getCurrentPrincipalState(
    "group",
    authorityPrincipalId,
    input.executor,
  );
  if (!authorityState) {
    throw new PrincipalPolicyError(
      "Stored principal policy external authority is missing",
      409,
    );
  }
  const authorityBundle = await buildPrincipalPolicyForStateWithExecutor(
    input.executor,
    authorityState,
  );
  const authoritySignerPublicKeys = await loadPolicySignerPublicKeys(
    input.executor,
    authorityBundle,
  );
  const authorityVerification = await verifyPrincipalPolicyBundle({
    bundle: authorityBundle,
    expectedReference: principalPolicyReference(authorityBundle.currentState),
    localCheckpoint: null,
    signerPublicKeys: authoritySignerPublicKeys,
  });
  if (!authorityVerification.ok) {
    throw integrityFailure(
      "Stored external admin policy failed integrity verification",
      authorityVerification.error.message,
    );
  }
  assertReservedAdminsPolicyShape(authorityVerification.value);

  const verified = await verifyPrincipalPolicyBundle({
    bundle: input.bundle,
    expectedReference,
    externalAuthority: externalAuthorityFromPolicy(authorityVerification.value),
    localCheckpoint: null,
    signerPublicKeys,
  });
  if (!verified.ok) {
    throw integrityFailure(
      "Stored principal policy failed integrity verification",
      verified.error.message,
    );
  }
  return verified.value;
}
