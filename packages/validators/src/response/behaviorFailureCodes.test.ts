import { expect, test } from "bun:test";
import {
  isSessionRefreshRequiredFailure,
  SESSION_ERROR_CODES,
  SessionFailureResponseSchema,
} from "./auth/sessionFailure";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  ContainerMutationFailureResponseSchema,
} from "./containerMutationError";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  ContainerNotFoundErrorResponseSchema,
} from "./containerNotFoundError";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  DocumentMutationFailureResponseSchema,
} from "./documentMutationError";
import { DOCUMENT_SYNC_ERROR_CODES } from "./documentSyncError";
import {
  ORGANIZATION_PRESENTATION_ERROR_CODES,
  OrganizationPresentationFailureResponseSchema,
} from "./organizationPresentationError";

test("behavior-bearing failure schemas accept every registered code", () => {
  expect(
    SessionFailureResponseSchema.safeParse({
      code: SESSION_ERROR_CODES.refreshRequired,
      error: "Diagnostic",
    }).success,
  ).toBe(true);
  expect(
    ContainerNotFoundErrorResponseSchema.safeParse({
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      error: "Diagnostic",
    }).success,
  ).toBe(true);
  expect(
    OrganizationPresentationFailureResponseSchema.safeParse({
      code: ORGANIZATION_PRESENTATION_ERROR_CODES.accessDenied,
      error: "Diagnostic",
    }).success,
  ).toBe(true);

  for (const code of Object.values(DOCUMENT_MUTATION_ERROR_CODES)) {
    expect(
      DocumentMutationFailureResponseSchema.safeParse({
        code,
        error: "Diagnostic",
      }).success,
    ).toBe(true);
  }

  for (const code of Object.values(CONTAINER_MUTATION_ERROR_CODES)) {
    expect(
      ContainerMutationFailureResponseSchema.safeParse({
        code,
        error: "Diagnostic",
      }).success,
    ).toBe(true);
  }
  expect(
    ContainerMutationFailureResponseSchema.safeParse({
      code: "principal_policy_stale",
      error: "Diagnostic",
      principalPolicies: [],
    }).success,
  ).toBe(true);

  for (const code of Object.values(DOCUMENT_SYNC_ERROR_CODES)) {
    expect(
      DocumentMutationFailureResponseSchema.safeParse({
        code,
        error: "Diagnostic",
      }).success,
    ).toBe(true);
    expect(
      ContainerMutationFailureResponseSchema.safeParse({
        code,
        error: "Diagnostic",
      }).success,
    ).toBe(true);
  }
});

test("terminal uncoded failures remain valid but carry no behavior", () => {
  const terminal = { error: "Opaque terminal failure" };

  expect(SessionFailureResponseSchema.safeParse(terminal).success).toBe(true);
  expect(
    DocumentMutationFailureResponseSchema.safeParse(terminal).success,
  ).toBe(true);
  expect(
    ContainerMutationFailureResponseSchema.safeParse(terminal).success,
  ).toBe(true);
  expect(isSessionRefreshRequiredFailure(terminal)).toBe(false);
});

test("malformed and unknown behavior tags fail schema validation", () => {
  const invalidCodes: readonly unknown[] = [
    null,
    false,
    0,
    {},
    [],
    "",
    " ",
    "unknown_code",
    ` ${SESSION_ERROR_CODES.refreshRequired} `,
  ];

  for (const code of invalidCodes) {
    const failure = { code, error: "Diagnostic" };
    expect(SessionFailureResponseSchema.safeParse(failure).success).toBe(false);
    expect(
      ContainerNotFoundErrorResponseSchema.safeParse(failure).success,
    ).toBe(false);
    expect(
      OrganizationPresentationFailureResponseSchema.safeParse(failure).success,
    ).toBe(false);
    expect(
      DocumentMutationFailureResponseSchema.safeParse(failure).success,
    ).toBe(false);
    expect(
      ContainerMutationFailureResponseSchema.safeParse(failure).success,
    ).toBe(false);
    expect(isSessionRefreshRequiredFailure(failure)).toBe(false);
  }
});
