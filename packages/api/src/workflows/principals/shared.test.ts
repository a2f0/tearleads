import { expect, test } from "bun:test";
import {
  PrincipalMemberEnvelopeValidationError,
  PrincipalPolicyValidationError,
  type PrincipalPolicyValidationErrorCode,
} from "@tearleads/crypto";
import { toPrincipalPolicyError } from "./shared";

test("principal policy validation codes determine HTTP status independently of wording", () => {
  const cases: ReadonlyArray<{
    code: PrincipalPolicyValidationErrorCode;
    expectedMessage: string;
    status: 400 | 403 | 404 | 409;
  }> = [
    {
      code: "invalid_artifact",
      expectedMessage: "wording can change",
      status: 400,
    },
    {
      code: "unauthorized_signer",
      expectedMessage: "wording can change",
      status: 403,
    },
    {
      code: "missing_state",
      expectedMessage: "Principal state not found",
      status: 404,
    },
    {
      code: "state_conflict",
      expectedMessage: "wording can change",
      status: 409,
    },
  ];

  for (const { code, expectedMessage, status } of cases) {
    const mapped = toPrincipalPolicyError(
      new PrincipalPolicyValidationError(code, "wording can change"),
    );

    expect(mapped?.message).toBe(expectedMessage);
    expect(mapped?.status).toBe(status);
  }
});

test("principal member envelope validation remains a typed bad request", () => {
  const source = new PrincipalMemberEnvelopeValidationError(
    "Principal member envelope is invalid",
  );
  const mapped = toPrincipalPolicyError(source);

  expect(source).toBeInstanceOf(PrincipalPolicyValidationError);
  expect(mapped?.message).toBe(source.message);
  expect(mapped?.status).toBe(400);
});

test("plain errors are not classified by message", () => {
  expect(
    toPrincipalPolicyError(new Error("Principal state version conflict")),
  ).toBeNull();
});
