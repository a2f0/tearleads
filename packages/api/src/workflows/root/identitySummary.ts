import { users } from "@tearleads/api-shared/schema";

/** Operator-facing view of one registered identity. Dates are ISO strings. */
export interface RootIdentitySummary {
  readonly createdAt: string;
  readonly defaultOrganizationId: string;
  readonly isRoot: boolean;
  readonly lastActiveAt: string | null;
  readonly registrationSourceIpAddress: string | null;
  readonly signingKeyFingerprint: string;
  readonly userId: string;
}

export const rootIdentitySelection = {
  createdAt: users.createdAt,
  defaultOrganizationId: users.defaultOrganizationId,
  isRoot: users.isRoot,
  lastActiveAt: users.lastActiveAt,
  registrationSourceIpAddress: users.registrationSourceIpAddress,
  signingKeyFingerprint: users.fingerprint,
  userId: users.id,
} as const;

interface RootIdentityRow {
  readonly createdAt: Date;
  readonly defaultOrganizationId: string;
  readonly isRoot: boolean;
  readonly lastActiveAt: Date | null;
  readonly registrationSourceIpAddress: string | null;
  readonly signingKeyFingerprint: string;
  readonly userId: string;
}

export function toRootIdentitySummary(
  row: RootIdentityRow,
): RootIdentitySummary {
  return {
    createdAt: row.createdAt.toISOString(),
    defaultOrganizationId: row.defaultOrganizationId,
    isRoot: row.isRoot,
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    registrationSourceIpAddress: row.registrationSourceIpAddress,
    signingKeyFingerprint: row.signingKeyFingerprint,
    userId: row.userId,
  };
}
