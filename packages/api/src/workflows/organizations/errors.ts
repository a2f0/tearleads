import type { BillingErrorCode } from "@symcrypt/validators/billing";

type OrganizationManagerErrorStatus = 400 | 403 | 404 | 409 | 503;

export class OrganizationManagerError extends Error {
  constructor(
    message: string,
    readonly status: OrganizationManagerErrorStatus,
    readonly code?: BillingErrorCode,
  ) {
    super(message);
  }
}
