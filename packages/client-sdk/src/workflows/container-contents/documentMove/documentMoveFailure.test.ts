import { expect, test } from "bun:test";
import { ORGANIZATION_TWO_FACTOR_ERROR_CODES } from "@tearleads/validators/response";
import { describeDocumentSyncSubmitFailure } from "../../documents/syncFailures/syncFailureClassification";
import {
  createDocumentMoveFailureState,
  recordDocumentMoveFailure,
} from "./documentMoveFailure";

const twoFactorRefusal = {
  code: ORGANIZATION_TWO_FACTOR_ERROR_CODES.required,
  message: "Two-factor authentication required",
  status: 403,
};

test("a second-factor refusal leaves a move pending, unlike a denial", () => {
  const refused = createDocumentMoveFailureState();
  recordDocumentMoveFailure(refused, twoFactorRefusal);
  expect(refused.sawPermissionDenial).toBe(false);

  const denied = createDocumentMoveFailureState();
  recordDocumentMoveFailure(denied, { message: "Forbidden", status: 403 });
  expect(denied.sawPermissionDenial).toBe(true);

  // A denial later in the same pass still parks the move.
  recordDocumentMoveFailure(refused, { message: "Forbidden", status: 403 });
  expect(refused.sawPermissionDenial).toBe(true);
});

test("a write a second factor held names that, not a denial", () => {
  expect(describeDocumentSyncSubmitFailure(twoFactorRefusal)).toBe(
    "The organization requires two-factor sign-in (403)",
  );
  expect(
    describeDocumentSyncSubmitFailure({ message: "Forbidden", status: 403 }),
  ).toBe("Write access denied by the server (403)");
});
