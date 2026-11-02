import { base64ToBytes } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { z } from "zod";

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

const positiveSafeIntegerSchema = z.int().min(1);

// Stored descriptors are exact: unknown keys and non-plain values are rejected.
const groupHeadSchema = z.custom<Record<string, unknown>>(isPlainObject).pipe(
  z.strictObject({
    principalType: z.literal("group"),
    principalId: z.string().min(1),
    version: positiveSafeIntegerSchema,
    keyEpoch: positiveSafeIntegerSchema,
    stateHash: z.string().min(1),
    keyFingerprint: z.string().min(1),
  }),
);

const authorityDescriptorSchema = z
  .custom<Record<string, unknown>>(isPlainObject)
  .pipe(
    z.strictObject({
      version: z.literal(2),
      organizationId: z.string(),
      adminGroupId: z.string(),
      memberGroupId: z.string(),
      groupHeads: z.array(groupHeadSchema),
    }),
  );

function compareGroupHeads(
  left: OrganizationGroupHead,
  right: OrganizationGroupHead,
): number {
  return left.principalId < right.principalId
    ? -1
    : left.principalId > right.principalId
      ? 1
      : 0;
}

export function parseOrganizationAuthorityDescriptor(
  ciphertext: string,
): OrganizationAuthorityDescriptor | null {
  try {
    const parsed = authorityDescriptorSchema.safeParse(
      JSON.parse(new TextDecoder().decode(base64ToBytes(ciphertext))),
    );
    if (!parsed.success) {
      return null;
    }
    const value = parsed.data;
    const normalized = [...value.groupHeads].sort(compareGroupHeads);
    if (
      value.adminGroupId === value.memberGroupId ||
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
