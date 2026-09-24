import {
  computePrincipalStatePayloadCiphertextHash,
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  principalPolicyMatchesReference,
} from "@tearleads/crypto";
import type {
  OrganizationPolicyHistoryResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { verifyPrincipalPolicySnapshots } from "../../data/keyingProjectionVerification/principalPolicySnapshotVerification";
import {
  type OrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../../data/principals/organizationAuthorityDescriptor";
import { verifyOrganizationAdminPolicy } from "../../data/principals/principalPolicyAdminSigners";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { collectPrincipalPolicySignerPublicKeys } from "../principals/policyVerification";

function reject(message: string): never {
  throw new KeyingVerificationError(
    "hash_mismatch",
    `Organization policy history: ${message}`,
  );
}

async function verifyDirectoryPayloads(
  bundle: PrincipalPolicyBundleResponse,
  evidence: OrganizationPolicyHistoryResponse,
  organizationId: string,
) {
  const states = [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
  if (evidence.organizationPayloads.length !== states.length)
    reject("directory history is incomplete");
  const descriptors = new Map<string, OrganizationAuthorityDescriptor>();
  for (const payload of evidence.organizationPayloads) {
    const state = states.find(
      (candidate) => candidate.stateHash === payload.stateHash,
    );
    if (
      !state ||
      descriptors.has(payload.stateHash) ||
      payload.principalType !== "organization" ||
      payload.principalId !== organizationId
    )
      reject("directory payload scope is invalid");
    const hash = await computePrincipalStatePayloadCiphertextHash(
      payload.ciphertext,
    );
    if (hash !== state.payloadCiphertextHash || hash !== payload.ciphertextHash)
      reject("directory payload does not match its signed hash");
    const descriptor = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (descriptor.organizationId !== organizationId)
      reject("directory belongs to another organization");
    descriptors.set(state.stateHash, descriptor);
  }
  return descriptors;
}

/** All returned data is authenticated against the already selected organization head. */
export async function verifyOrganizationPolicyHistory(input: {
  bundle: PrincipalPolicyBundleResponse;
  evidence: OrganizationPolicyHistoryResponse;
  organizationId: string;
  localCheckpoint: PrincipalPolicyCheckpoint | null;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}) {
  const { bundle, evidence, organizationId } = input;
  if (
    evidence.organizationId !== organizationId ||
    evidence.stateHash !== bundle.currentState.stateHash
  )
    reject("response does not match the requested organization head");
  const keys = await collectPrincipalPolicySignerPublicKeys(input);
  if ("error" in keys) reject("signer identity is unavailable");
  const verified = await verifyOrganizationAdminPolicy({
    ...input,
    signerPublicKeys: keys.signerPublicKeys,
  });
  if (!verified.ok) throw verified.error;
  const descriptors = await verifyDirectoryPayloads(
    bundle,
    evidence,
    organizationId,
  );
  // These are historical display proofs, authenticated by the selected
  // organization chain. They never advance a group's current-policy checkpoint.
  const groups = await verifyPrincipalPolicySnapshots({
    resolveUserKey: input.resolveTrustedUserIdentity,
    snapshots: evidence.groups,
  });
  const expectedGroups = new Set<string>();
  for (const descriptor of descriptors.values()) {
    for (const reference of descriptor.groupHeads) {
      expectedGroups.add(reference.principalId);
      const policy = groups.find(
        (group) =>
          group.principalType === "group" &&
          group.principalId === reference.principalId,
      );
      if (!policy || !principalPolicyMatchesReference({ policy, reference }))
        reject("group history does not match the signed directory");
    }
  }
  if (groups.length !== expectedGroups.size) reject("unexpected group history");
  for (const group of groups) {
    const heads = [...descriptors.values()].flatMap((descriptor) =>
      descriptor.groupHeads.filter(
        (head) => head.principalId === group.principalId,
      ),
    );
    const latest = heads.reduce((left, right) =>
      left.version > right.version ? left : right,
    );
    if (group.stateHash !== latest.stateHash)
      reject("group history extends beyond the selected organization head");
  }
  return { descriptors, groups };
}
