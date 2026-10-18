import type { RequestFailure } from "@tearleads/api-client";
import { ORGANIZATION_PRESENTATION_ERROR_CODES } from "@tearleads/validators/response";

export function isOrganizationPresentationAccessDeniedFailure(
  failure: RequestFailure,
): boolean {
  return (
    failure.kind === "http" &&
    (failure.status === 403 || failure.status === 404) &&
    failure.code === ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied
  );
}
