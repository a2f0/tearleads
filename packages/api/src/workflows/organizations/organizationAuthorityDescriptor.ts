import { base64ToBytes } from "@tearleads/encoding";

export interface OrganizationGroupHead {
  readonly keyEpoch: number;
  readonly keyFingerprint: string;
  readonly principalId: string;
  readonly principalType: "group";
  readonly stateHash: string;
  readonly version: number;
}

interface OrganizationAuthorityDescriptor {
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

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
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

export function parseOrganizationAuthorityDescriptor(
  ciphertext: string,
): OrganizationAuthorityDescriptor | null {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder().decode(base64ToBytes(ciphertext)),
    );
    if (
      !isPlainRecord(value) ||
      !hasExactKeys(value, [
        "version",
        "organizationId",
        "adminGroupId",
        "memberGroupId",
        "groupHeads",
      ]) ||
      value.version !== 2 ||
      typeof value.organizationId !== "string" ||
      typeof value.adminGroupId !== "string" ||
      typeof value.memberGroupId !== "string" ||
      value.adminGroupId === value.memberGroupId ||
      !Array.isArray(value.groupHeads)
    ) {
      return null;
    }
    const groupHeads: OrganizationGroupHead[] = [];
    for (const candidate of value.groupHeads) {
      const head = parseGroupHead(candidate);
      if (!head) {
        return null;
      }
      groupHeads.push(head);
    }
    const normalized = [...groupHeads].sort((left, right) =>
      left.principalId.localeCompare(right.principalId),
    );
    if (
      normalized.some(
        (head, index) =>
          head.principalId === normalized[index - 1]?.principalId,
      ) ||
      !normalized.some((head) => head.principalId === value.adminGroupId) ||
      !normalized.some((head) => head.principalId === value.memberGroupId)
    ) {
      return null;
    }
    return {
      version: 2,
      organizationId: value.organizationId,
      adminGroupId: value.adminGroupId,
      memberGroupId: value.memberGroupId,
      groupHeads: normalized,
    };
  } catch {
    return null;
  }
}
