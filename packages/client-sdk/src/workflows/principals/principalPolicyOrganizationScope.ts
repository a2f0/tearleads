import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalPolicyHeadMeetsCheckpoint } from "../../data/persistence/principalPolicyCheckpointSelection";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  type OrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../../data/principals/organizationAuthorityDescriptor";
import { verifyOrganizationAdminPolicy } from "../../data/principals/principalPolicyAdminSigners";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { collectPrincipalPolicySignerPublicKeys } from "./policyVerification";

export interface VerifiedPolicyDirectory {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
  readonly descriptor: OrganizationAuthorityDescriptor;
}

export type PolicyDirectoryLoader = (
  remote: boolean,
) => Promise<VerifiedPolicyDirectory | null>;

export function directoryBindsGroupReference(
  directory: VerifiedPolicyDirectory | null,
  policy: VerifiedPrincipalPolicy,
  reference: ReferencedPrincipalHead,
): boolean {
  const head = directory?.descriptor.groupHeads.find(
    (head) => head.principalId === reference.principalId,
  );
  // A newer directory head authenticates its verified predecessors too.
  // Requiring equality with a historical manifest citation bricks old reads.
  return (
    !!head &&
    head.version >= reference.version &&
    head.version === policy.version &&
    [policy.state, ...(policy.history ?? []).map((entry) => entry.state)].some(
      (state) => principalHeadMatchesReference(state, head),
    )
  );
}

export function createPolicyDirectoryLoader(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly getCurrentPrincipalPolicy: (
    kind: "group" | "organization",
    id: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): PolicyDirectoryLoader {
  const memo = new Map<boolean, Promise<VerifiedPolicyDirectory | null>>();
  const load = async (
    remote: boolean,
  ): Promise<VerifiedPolicyDirectory | null> => {
    const checkpoint = await loadPrincipalPolicyCheckpoint(
      input.execSql,
      "organization",
      input.organizationId,
    );
    let bundle = remote
      ? null
      : await loadPrincipalPolicyBundle(
          input.execSql,
          "organization",
          input.organizationId,
        );
    if (
      bundle &&
      !principalPolicyHeadMeetsCheckpoint(bundle.currentState, checkpoint)
    )
      bundle = null;
    bundle ??= await input.getCurrentPrincipalPolicy(
      "organization",
      input.organizationId,
    );
    if (!bundle) return null;
    const signers = await collectPrincipalPolicySignerPublicKeys({
      bundle,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    });
    if ("error" in signers) {
      if (signers.error === "fingerprint-mismatch")
        throw new KeyingVerificationError(
          "signer_mismatch",
          "organization directory signer fingerprint does not match",
        );
      return null;
    }
    const verified = await verifyOrganizationAdminPolicy({
      bundle,
      localCheckpoint: checkpoint,
      organizationId: input.organizationId,
      signerPublicKeys: signers.signerPublicKeys,
    });
    if (!verified.ok) throw verified.error;
    let descriptor: OrganizationAuthorityDescriptor;
    try {
      descriptor = parseOrganizationAuthorityDescriptor(
        bundle.currentPayload.ciphertext,
      );
    } catch {
      throw new KeyingVerificationError(
        "invalid_shape",
        "organization directory payload is invalid",
      );
    }
    if (descriptor.organizationId !== input.organizationId)
      throw new KeyingVerificationError(
        "object_mismatch",
        "organization directory scope does not match",
      );
    return { bundle, policy: verified.value, descriptor };
  };
  return (remote) => {
    let pending = memo.get(remote);
    if (!pending) {
      pending = load(remote);
      memo.set(remote, pending);
    }
    return pending;
  };
}
