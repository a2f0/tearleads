import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  sha256HexStringSchema,
} from "../schema";
import { OrganizationBillingStatusSchema } from "./organizationBilling";

export const RootRosterSchema = loosePlainObject({
  disabledAt: z.string().nullable(),
  joinedAt: z.string(),
  status: z.literal(["active", "disabled"]),
});

/** Operator-facing view of one registered identity, from `GET /root/identities`. */
export const RootIdentitySummaryResponseSchema = loosePlainObject({
  createdAt: z.string(),
  defaultOrganizationId: nonEmptyStringSchema,
  isRoot: z.boolean(),
  lastActiveAt: z.string().nullable(),
  registrationSourceIpAddress: z.string().nullable(),
  signingKeyFingerprint: sha256HexStringSchema,
  userId: nonEmptyStringSchema,
});

export type RootIdentitySummaryResponse = z.infer<
  typeof RootIdentitySummaryResponseSchema
>;

export const RootIdentitiesResponseSchema = loosePlainObject({
  identities: arraySchema(RootIdentitySummaryResponseSchema),
  /** Opaque cursor for the next page; null when the listing is exhausted. */
  nextCursor: z.string().nullable(),
});

export type RootIdentitiesResponse = z.infer<
  typeof RootIdentitiesResponseSchema
>;

/** A live session of the inspected identity; no session is the operator's. */
export const RootIdentitySessionResponseSchema = loosePlainObject({
  createdAt: z.string(),
  id: sha256HexStringSchema,
  ipAddresses: arraySchema(nonEmptyStringSchema),
  lastActiveAt: z.string(),
  lastActiveIp: nonEmptyStringSchema.nullable(),
  signingKeyFingerprint: z.string(),
});

export type RootIdentitySessionResponse = z.infer<
  typeof RootIdentitySessionResponseSchema
>;

export const RootIdentityDetailResponseSchema = loosePlainObject({
  identity: RootIdentitySummaryResponseSchema,
  sessions: arraySchema(RootIdentitySessionResponseSchema),
});

export type RootIdentityDetailResponse = z.infer<
  typeof RootIdentityDetailResponseSchema
>;

export const rootOrganizationBillingShape = {
  currentPeriodEndsAt: z.string().nullable(),
  disabledAt: z.string().nullable(),
  provider: z.string().nullable(),
  purgeAfter: z.string().nullable(),
  purgedAt: z.string().nullable(),
  seatCount: nonNegativeIntegerSchema,
  status: OrganizationBillingStatusSchema,
  trialEndsAt: z.string().nullable(),
};
export const RootIdentityOrganizationBillingResponseSchema = loosePlainObject(
  rootOrganizationBillingShape,
);

export type RootIdentityOrganizationBillingResponse = z.infer<
  typeof RootIdentityOrganizationBillingResponseSchema
>;

export const RootIdentityOrganizationResponseSchema = loosePlainObject({
  /** Null only when the organization has no billing row, which is unexpected. */
  billing: RootIdentityOrganizationBillingResponseSchema.nullable(),
  createdAt: z.string(),
  isDefaultOrganization: z.boolean(),
  name: z.string(),
  organizationId: nonEmptyStringSchema,
  roster: RootRosterSchema,
});

export type RootIdentityOrganizationResponse = z.infer<
  typeof RootIdentityOrganizationResponseSchema
>;

export const RootIdentityOrganizationsResponseSchema = loosePlainObject({
  organizations: arraySchema(RootIdentityOrganizationResponseSchema),
});

export type RootIdentityOrganizationsResponse = z.infer<
  typeof RootIdentityOrganizationsResponseSchema
>;

export function isRootIdentitiesResponse(
  value: unknown,
): value is RootIdentitiesResponse {
  return RootIdentitiesResponseSchema.safeParse(value).success;
}

export function isRootIdentityDetailResponse(
  value: unknown,
): value is RootIdentityDetailResponse {
  return RootIdentityDetailResponseSchema.safeParse(value).success;
}

export function isRootIdentityOrganizationsResponse(
  value: unknown,
): value is RootIdentityOrganizationsResponse {
  return RootIdentityOrganizationsResponseSchema.safeParse(value).success;
}
