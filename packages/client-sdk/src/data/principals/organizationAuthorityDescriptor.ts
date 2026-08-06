import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";

export interface OrganizationAuthorityDescriptor {
  readonly adminGroupId: string;
  readonly memberGroupId: string;
  readonly organizationId: string;
  readonly version: 1;
}

interface OrganizationAuthorityDescriptorCandidate {
  readonly [key: string]: unknown;
  readonly adminGroupId?: unknown;
  readonly memberGroupId?: unknown;
  readonly organizationId?: unknown;
  readonly version?: unknown;
}

function isPlainRecord(
  value: unknown,
): value is OrganizationAuthorityDescriptorCandidate {
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
    ]) ||
    parsed.version !== 1 ||
    typeof parsed.organizationId !== "string" ||
    parsed.organizationId.length === 0 ||
    typeof parsed.adminGroupId !== "string" ||
    parsed.adminGroupId.length === 0 ||
    typeof parsed.memberGroupId !== "string" ||
    parsed.memberGroupId.length === 0 ||
    parsed.adminGroupId === parsed.memberGroupId
  ) {
    throw new Error("Organization authority descriptor is invalid");
  }

  return {
    version: 1,
    organizationId: parsed.organizationId,
    adminGroupId: parsed.adminGroupId,
    memberGroupId: parsed.memberGroupId,
  };
}
