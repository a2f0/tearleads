import { base64ToBytes } from "@tearleads/encoding";

interface OrganizationAuthorityDescriptor {
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

function isOrganizationAuthorityDescriptorCandidate(
  value: unknown,
): value is OrganizationAuthorityDescriptorCandidate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOrganizationAuthorityDescriptor(
  ciphertext: string,
): OrganizationAuthorityDescriptor | null {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder().decode(base64ToBytes(ciphertext)),
    );
    if (!isOrganizationAuthorityDescriptorCandidate(value)) {
      return null;
    }
    const descriptor = value;
    const keys = Object.keys(descriptor);
    if (
      keys.length !== 4 ||
      !keys.every((key) =>
        ["version", "organizationId", "adminGroupId", "memberGroupId"].includes(
          key,
        ),
      ) ||
      descriptor.version !== 1 ||
      typeof descriptor.organizationId !== "string" ||
      typeof descriptor.adminGroupId !== "string" ||
      typeof descriptor.memberGroupId !== "string" ||
      descriptor.adminGroupId === descriptor.memberGroupId
    ) {
      return null;
    }
    return {
      version: 1,
      organizationId: descriptor.organizationId,
      adminGroupId: descriptor.adminGroupId,
      memberGroupId: descriptor.memberGroupId,
    };
  } catch {
    return null;
  }
}
