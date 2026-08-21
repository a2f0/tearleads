import type { ReferencedPrincipalHead } from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";

export type OrganizationGroupHead = ReferencedPrincipalHead & {
  readonly principalType: "group";
};

export interface OrganizationAuthorityDescriptor {
  readonly adminGroupId: string;
  readonly groupHeads: readonly OrganizationGroupHead[];
  readonly memberGroupId: string;
  readonly organizationId: string;
  readonly version: 2;
}

interface DescriptorCandidate extends Record<string, unknown> {
  adminGroupId?: unknown;
  groupHeads?: unknown;
  keyEpoch?: unknown;
  keyFingerprint?: unknown;
  memberGroupId?: unknown;
  organizationId?: unknown;
  principalId?: unknown;
  principalType?: unknown;
  stateHash?: unknown;
  version?: unknown;
}

function isPlainRecord(value: unknown): value is DescriptorCandidate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function parseGroupHead(value: unknown): OrganizationGroupHead | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "principalType",
      "principalId",
      "version",
      "keyEpoch",
      "stateHash",
      "keyFingerprint",
    ]) ||
    value.principalType !== "group" ||
    typeof value.principalId !== "string" ||
    value.principalId.length === 0 ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1 ||
    !Number.isSafeInteger(value.keyEpoch) ||
    Number(value.keyEpoch) < 1 ||
    typeof value.stateHash !== "string" ||
    value.stateHash.length === 0 ||
    typeof value.keyFingerprint !== "string" ||
    value.keyFingerprint.length === 0
  ) {
    return null;
  }
  return {
    principalType: "group",
    principalId: value.principalId,
    version: Number(value.version),
    keyEpoch: Number(value.keyEpoch),
    stateHash: value.stateHash,
    keyFingerprint: value.keyFingerprint,
  };
}

export function normalizeOrganizationGroupHeads(
  heads: readonly OrganizationGroupHead[],
): OrganizationGroupHead[] {
  const sorted = [...heads].sort((left, right) =>
    left.principalId.localeCompare(right.principalId),
  );
  if (
    sorted.some(
      (head, index) => head.principalId === sorted[index - 1]?.principalId,
    )
  ) {
    throw new Error("Organization authority descriptor has duplicate groups");
  }
  return sorted;
}

export function encodeOrganizationAuthorityDescriptor(
  descriptor: OrganizationAuthorityDescriptor,
): string {
  return bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({
        version: descriptor.version,
        organizationId: descriptor.organizationId,
        adminGroupId: descriptor.adminGroupId,
        memberGroupId: descriptor.memberGroupId,
        groupHeads: normalizeOrganizationGroupHeads(descriptor.groupHeads),
      }),
    ),
  );
}

export function parseOrganizationAuthorityDescriptor(
  ciphertext: string,
): OrganizationAuthorityDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64ToBytes(ciphertext)));
  } catch {
    throw new Error("Organization authority descriptor is invalid");
  }

  if (
    !isPlainRecord(parsed) ||
    !hasExactKeys(parsed, [
      "version",
      "organizationId",
      "adminGroupId",
      "memberGroupId",
      "groupHeads",
    ]) ||
    parsed.version !== 2 ||
    typeof parsed.organizationId !== "string" ||
    parsed.organizationId.length === 0 ||
    typeof parsed.adminGroupId !== "string" ||
    parsed.adminGroupId.length === 0 ||
    typeof parsed.memberGroupId !== "string" ||
    parsed.memberGroupId.length === 0 ||
    parsed.adminGroupId === parsed.memberGroupId ||
    !Array.isArray(parsed.groupHeads)
  ) {
    throw new Error("Organization authority descriptor is invalid");
  }

  const groupHeads: OrganizationGroupHead[] = [];
  for (const candidate of parsed.groupHeads) {
    const head = parseGroupHead(candidate);
    if (!head) {
      throw new Error("Organization authority descriptor is invalid");
    }
    groupHeads.push(head);
  }
  const normalized = normalizeOrganizationGroupHeads(groupHeads);
  if (
    !normalized.some((head) => head.principalId === parsed.adminGroupId) ||
    !normalized.some((head) => head.principalId === parsed.memberGroupId)
  ) {
    throw new Error("Organization authority descriptor is invalid");
  }

  return {
    version: 2,
    organizationId: parsed.organizationId,
    adminGroupId: parsed.adminGroupId,
    memberGroupId: parsed.memberGroupId,
    groupHeads: normalized,
  };
}

export function requireOrganizationGroupHead(
  descriptor: OrganizationAuthorityDescriptor,
  groupId: string,
): OrganizationGroupHead {
  const head = descriptor.groupHeads.find(
    (candidate) => candidate.principalId === groupId,
  );
  if (!head) {
    throw new Error("Group is absent from the signed organization directory");
  }
  return head;
}

export function principalHeadMatchesReference(
  head: ReferencedPrincipalHead,
  reference: ReferencedPrincipalHead,
): boolean {
  return (
    head.principalType === reference.principalType &&
    head.principalId === reference.principalId &&
    head.version === reference.version &&
    head.keyEpoch === reference.keyEpoch &&
    head.stateHash === reference.stateHash &&
    head.keyFingerprint === reference.keyFingerprint
  );
}
