import {
  computePrincipalStatePayloadCiphertextHash,
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { OrganizationPolicyHistoryResponse } from "@tearleads/validators/response";
import {
  type OrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../../data/principals/organizationAuthorityDescriptor";
import type { RecoveredPrincipalHistoryPage } from "../principals/loadRecoveredPrincipalHistoryPage";

function reject(message: string): never {
  throw new KeyingVerificationError(
    "hash_mismatch",
    `Organization policy history: ${message}`,
  );
}

/** Bind every display payload and public source to the privately verified page. */
export async function verifyOrganizationPolicyHistory(input: {
  readonly head: ReferencedPrincipalHead;
  readonly page: RecoveredPrincipalHistoryPage;
  readonly evidence: OrganizationPolicyHistoryResponse;
}) {
  const { head, page, evidence } = input;
  const beforeVersion = (page.entries.at(-1)?.state.version ?? 0) + 1;
  if (
    head.principalType !== "organization" ||
    evidence.organizationId !== head.principalId ||
    evidence.stateHash !== head.stateHash ||
    evidence.beforeVersion !== beforeVersion ||
    evidence.nextBeforeVersion !== page.nextBeforeVersion ||
    !evidence.evidence.organization ||
    !principalHeadMatchesReference(evidence.evidence.organization.head, head)
  )
    reject("response does not match the requested organization page");
  const entries = page.predecessor
    ? [page.predecessor, ...page.entries]
    : page.entries;
  if (evidence.evidence.organizationPayloads.length !== entries.length)
    reject("directory page is incomplete");
  const descriptors = new Map<string, OrganizationAuthorityDescriptor>();
  const references: ReferencedPrincipalHead[] = [head];
  const groups = new Map<string, ReferencedPrincipalHead>();
  for (const [
    index,
    item,
  ] of evidence.evidence.organizationPayloads.entries()) {
    const { reference, payload } = item;
    const entry = entries[index];
    if (
      !entry ||
      !principalHeadMatchesReference(entry.state, reference) ||
      payload.principalType !== "organization" ||
      payload.principalId !== head.principalId ||
      payload.stateHash !== reference.stateHash ||
      descriptors.has(reference.stateHash)
    )
      reject("directory payload scope or order is invalid");
    const hash = await computePrincipalStatePayloadCiphertextHash(
      payload.ciphertext,
    );
    if (
      hash !== entry.state.payloadCiphertextHash ||
      hash !== payload.ciphertextHash
    )
      reject("directory payload does not match its signed hash");
    const descriptor = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (descriptor.organizationId !== head.principalId)
      reject("directory belongs to another organization");
    descriptors.set(reference.stateHash, descriptor);
    references.push(reference, ...descriptor.groupHeads);
    for (const group of descriptor.groupHeads) {
      const previous = groups.get(group.principalId);
      if (!previous || group.version > previous.version)
        groups.set(group.principalId, group);
    }
  }
  verifyGroupSources(evidence, groups);
  return { descriptors, references };
}

function verifyGroupSources(
  evidence: OrganizationPolicyHistoryResponse,
  groups: Map<string, ReferencedPrincipalHead>,
) {
  if (evidence.evidence.groups.length !== groups.size)
    reject("unexpected group source");
  const seen = new Set<string>();
  for (const source of evidence.evidence.groups) {
    const expected = groups.get(source.head.principalId);
    if (
      !expected ||
      seen.has(source.head.principalId) ||
      !principalHeadMatchesReference(source.head, expected)
    )
      reject("group source extends beyond the page's signed directory");
    seen.add(source.head.principalId);
  }
}
