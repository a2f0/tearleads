import type { BillingErrorCode } from "@tearleads/validators/billing";
import {
  ORGANIZATION_READ_MODEL_ERROR_CODES,
  type OrganizationReadModelErrorCode,
} from "@tearleads/validators/response";

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

export class OrganizationReadModelCursorError extends Error {
  readonly code: OrganizationReadModelErrorCode =
    ORGANIZATION_READ_MODEL_ERROR_CODES.cursorInvalid;
  readonly status = 400;
}
