import { expect, test } from "bun:test";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { DocumentKekTargetError } from "../../../access/read/documentKekTargets";
import {
  DocumentMutationError,
  documentSyncStateStale,
  documentUpdateIdConflict,
  toMutationError,
} from "./errors";

test("document sync conflict helpers assign stable protocol codes", () => {
  expect(documentSyncStateStale("State changed")).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    message: "State changed",
    status: 409,
  });
  expect(documentUpdateIdConflict()).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
    message: "Document update id conflict",
    status: 409,
  });
});

test("document mutation conversion preserves lower-layer protocol codes", () => {
  const converted = toMutationError(
    new DocumentKekTargetError(
      "Targets changed",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );

  expect(converted).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    message: "Targets changed",
    status: 409,
  });
  expect(new DocumentMutationError("Terminal conflict", 409).code).toBe(
    undefined,
  );
});
