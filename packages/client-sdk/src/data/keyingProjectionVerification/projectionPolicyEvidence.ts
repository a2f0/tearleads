import {
  computePrincipalStatePayloadCiphertextHash,
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicySnapshot,
} from "@tearleads/crypto";
import type { ProjectionPolicyEvidenceResponse } from "@tearleads/validators/response";
import {
  type OrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../sqlite/sqlSchema";
import {
  enforcePrincipalPolicySnapshotCheckpoints,
  verifyPrincipalPolicySnapshots,
} from "./principalPolicySnapshotVerification";
import type { ProjectionUserKeyResolver } from "./types";

function reject(message: string): never {
  throw new KeyingVerificationError(
    "object_mismatch",
    `Projection policy evidence: ${message}`,
  );
}

async function verifyDirectories(input: {
  readonly evidence: ProjectionPolicyEvidenceResponse;
  readonly organization: VerifiedPrincipalPolicySnapshot;
  readonly organizationId: string;
}): Promise<OrganizationAuthorityDescriptor[]> {
  const states = new Map(
    input.organization.history.map(({ state }) => [state.stateHash, state]),
  );
  const descriptors: OrganizationAuthorityDescriptor[] = [];
  for (const payload of input.evidence.organizationPayloads) {
    const state = states.get(payload.stateHash);
    if (
      !state ||
      payload.principalType !== "organization" ||
      payload.principalId !== input.organizationId
    )
      reject("directory payload scope is invalid");
    const hash = await computePrincipalStatePayloadCiphertextHash(
      payload.ciphertext,
    );
    if (hash !== state.payloadCiphertextHash || hash !== payload.ciphertextHash)
      reject("directory payload does not match its signed hash");
    const descriptor = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (descriptor.organizationId !== input.organizationId)
      reject("directory belongs to another organization");
    descriptors.push(descriptor);
    states.delete(payload.stateHash);
  }
  // Only directory payloads needed to bind the supplied group heads are
  // required. The organization's complete signed state chain is verified above;
  // unrelated payload bodies add no authority and need not be disclosed.
  return descriptors;
}

/** Evidence authenticates signed citations only; it never becomes current policy. */
export async function verifyProjectionPolicyEvidence(input: {
  readonly evidence: ProjectionPolicyEvidenceResponse;
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedPrincipalPolicySnapshot[]> {
  const { evidence, organizationId } = input;
  if (evidence.organization === null) {
    if (evidence.groups.length > 0 || evidence.organizationPayloads.length > 0)
      reject("group evidence requires its signed organization history");
    return [];
  }
  if (
    evidence.organization.currentState.principalType !== "organization" ||
    evidence.organization.currentState.principalId !== organizationId ||
    evidence.groups.some(
      (group) => group.currentState.principalType !== "group",
    )
  )
    reject("principal scope is invalid");
  const policies = await verifyPrincipalPolicySnapshots({
    resolveUserKey: input.resolveUserKey,
    snapshots: [evidence.organization, ...evidence.groups],
  });
  const organization = policies.find(
    (policy) => policy.principalType === "organization",
  );
  if (!organization) reject("organization snapshot is missing");
  const directories = await verifyDirectories({ ...input, organization });
  for (const group of policies.filter(
    (policy) => policy.principalType === "group",
  )) {
    const directory = directories.find((candidate) =>
      candidate.groupHeads.some((reference: ReferencedPrincipalHead) =>
        principalHeadMatchesReference(group.state, reference),
      ),
    );
    if (!directory)
      reject("group state is absent from signed directory history");
    // The snapshot's authenticated predecessor chain supplies older states;
    // only its bound head needs to appear in a directory payload.
    for (const { state } of group.history) {
      if (
        state.externalAuthority &&
        state.externalAuthority.principalId !== directory.adminGroupId
      )
        reject("group authority is not the organization's Admins group");
    }
  }
  // Check connection to known chains without pinning historical group heads or
  // caching keyless evidence as a live policy bundle.
  await enforcePrincipalPolicySnapshotCheckpoints({
    execSql: input.execSql,
    policies,
  });
  return policies;
}
