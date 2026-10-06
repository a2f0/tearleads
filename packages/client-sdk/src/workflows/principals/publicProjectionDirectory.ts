import {
  computePrincipalStatePayloadCiphertextHash,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { ProjectionPolicyHistoryEvidenceResponse } from "@tearleads/validators/response";
import {
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../../data/principals/organizationAuthorityDescriptor";
import {
  type PublicProjectionPrincipal,
  rejectPublicProjection,
  selectPublicProjectionPrincipal,
} from "./publicProjectionPrincipal";

export async function publicProjectionDirectoryBindings(
  evidence: ProjectionPolicyHistoryEvidenceResponse,
  organization: PublicProjectionPrincipal,
) {
  const policies = await selectPublicProjectionPrincipal(organization);
  const entries = policies.flatMap((policy) => policy.retainedHistory);
  const descriptors = [];
  const seen = new Set<string>();
  for (const { reference, payload } of evidence.organizationPayloads) {
    const state = entries.find(({ state }) =>
      principalHeadMatchesReference(state, reference),
    )?.state;
    if (
      !state ||
      reference.version > organization.options.source.head.version ||
      payload.principalType !== "organization" ||
      payload.principalId !== organization.options.organizationId ||
      payload.stateHash !== state.stateHash ||
      seen.has(state.stateHash)
    )
      rejectPublicProjection("directory payload scope is invalid");
    seen.add(state.stateHash);
    const hash = await computePrincipalStatePayloadCiphertextHash(
      payload.ciphertext,
    );
    if (hash !== payload.ciphertextHash || hash !== state.payloadCiphertextHash)
      rejectPublicProjection("directory payload differs from its signed hash");
    const descriptor = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (descriptor.organizationId !== organization.options.organizationId)
      rejectPublicProjection("directory belongs to another organization");
    descriptors.push(descriptor);
  }
  const bindings = new Map<string, { adminHead: ReferencedPrincipalHead }>();
  for (const source of evidence.groups) {
    if (
      source.head.principalType !== "group" ||
      bindings.has(source.head.principalId)
    )
      rejectPublicProjection("group sources have invalid or repeated scopes");
    const directory = descriptors.find((candidate) =>
      candidate.groupHeads.some((head) =>
        principalHeadMatchesReference(head, source.head),
      ),
    );
    const adminHead = directory?.groupHeads.find(
      (head) => head.principalId === directory.adminGroupId,
    );
    if (!adminHead)
      rejectPublicProjection("group source lacks its signed directory binding");
    bindings.set(source.head.principalId, { adminHead });
  }
  return bindings;
}
