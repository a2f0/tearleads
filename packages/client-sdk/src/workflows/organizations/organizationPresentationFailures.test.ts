import { expect, test } from "bun:test";
import type { RequestFailure } from "@tearleads/api-client";
import { ORGANIZATION_PRESENTATION_ERROR_CODES } from "@tearleads/validators/response";
import { isOrganizationPresentationAccessDeniedFailure } from "./organizationPresentationFailures";

function failure(input: {
  readonly code?: string | undefined;
  readonly kind?: RequestFailure["kind"] | undefined;
  readonly status: number | null;
}): RequestFailure {
  return {
    ...(input.code === undefined ? {} : { code: input.code }),
    kind: input.kind ?? "http",
    message: "Diagnostic",
    method: "GET",
    ok: false,
    path: "/organizations/org-1/read-model",
    report: () => {},
    status: input.status,
    statusText: "Denied",
  };
}

test("organization presentation purge requires exact status and code", () => {
  for (const status of [403, 404]) {
    expect(
      isOrganizationPresentationAccessDeniedFailure(
        failure({
          code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
          status,
        }),
      ),
    ).toBe(true);
  }

  for (const code of [
    undefined,
    "",
    "unknown_code",
    ` ${ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied} `,
  ]) {
    expect(
      isOrganizationPresentationAccessDeniedFailure(
        failure({ code, status: 404 }),
      ),
    ).toBe(false);
  }
  expect(
    isOrganizationPresentationAccessDeniedFailure(
      failure({
        code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
        status: 500,
      }),
    ),
  ).toBe(false);
  expect(
    isOrganizationPresentationAccessDeniedFailure(
      failure({
        code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
        kind: "network",
        status: 404,
      }),
    ),
  ).toBe(false);
});
