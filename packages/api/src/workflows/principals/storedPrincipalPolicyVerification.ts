import {
  type PrincipalPolicyExternalAuthority,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import { PrincipalPolicyError } from "./shared";
import type { StoredPrincipalPolicyVerificationSource } from "./storedPrincipalPolicySource";

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

function assertReservedAdminsPolicyShape(
  policy: VerifiedPrincipalPolicy,
): void {
  const history = policy.history ?? [
    {
      state: policy.state,
      projection: policy.projection,
      grants: policy.grants,
    },
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
    {
      state: policy.state,
      projection: policy.projection,
      grants: policy.grants,
    },
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

function integrityFailure(
  label: string,
  message: string,
): PrincipalPolicyError {
  return new PrincipalPolicyError(`${label}: ${message}`, 409);
}

export async function verifyStoredPrincipalPolicyBundle(input: {
  readonly source: StoredPrincipalPolicyVerificationSource;
}): Promise<VerifiedPrincipalPolicy> {
  const expectedReference = principalPolicyReference(
    input.source.bundle.currentState,
  );
  const directVerification = await verifyPrincipalPolicyBundle({
    bundle: input.source.bundle,
    expectedReference,
    localCheckpoint: null,
    signerPublicKeys: input.source.signerPublicKeys,
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

  if (!input.source.authority) {
    throw integrityFailure(
      "Stored principal policy failed integrity verification",
      directVerification.error.message,
    );
  }
  const authorityVerification = await verifyPrincipalPolicyBundle({
    bundle: input.source.authority.bundle,
    expectedReference: principalPolicyReference(
      input.source.authority.bundle.currentState,
    ),
    localCheckpoint: null,
    signerPublicKeys: input.source.authority.signerPublicKeys,
  });
  if (!authorityVerification.ok) {
    throw integrityFailure(
      "Stored external admin policy failed integrity verification",
      authorityVerification.error.message,
    );
  }
  assertReservedAdminsPolicyShape(authorityVerification.value);

  const verified = await verifyPrincipalPolicyBundle({
    bundle: input.source.bundle,
    expectedReference,
    externalAuthority: externalAuthorityFromPolicy(authorityVerification.value),
    localCheckpoint: null,
    signerPublicKeys: input.source.signerPublicKeys,
  });
  if (!verified.ok) {
    throw integrityFailure(
      "Stored principal policy failed integrity verification",
      verified.error.message,
    );
  }
  return verified.value;
}
