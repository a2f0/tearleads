import { expect, test } from "bun:test";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { DocumentKekTargetError } from "../../../access/read/documentKekTargets";
import { ContainerWriterProjectionError } from "../../containers/writerProjection/types";
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

test("sync access projection errors keep their status instead of a 500", () => {
  const conflict = toMutationError(
    new ContainerWriterProjectionError("Container head is stale", 409),
  );
  const forbidden = toMutationError(
    new ContainerWriterProjectionError("Container access denied", 403),
  );

  expect(conflict).toMatchObject({
    message: "Container head is stale",
    status: 409,
  });
  expect(forbidden).toMatchObject({
    message: "Container access denied",
    status: 403,
  });
});

test("container 404s do not become document-deletion 404s", () => {
  // Clients treat a sync-route 404 as upstream document deletion and wipe the
  // local document; a missing *container* projection must not trigger that.
  expect(
    toMutationError(
      new ContainerWriterProjectionError("Container not found", 404),
    ),
  ).toMatchObject({ message: "Container not found", status: 409 });
});

test("libSQL transaction interruption becomes a coded retryable conflict", () => {
  const transactionError = Object.assign(new Error("transaction timed out"), {
    code: "TRANSACTION_TIMEOUT",
  });

  expect(toMutationError(transactionError)).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    message: "Document mutation transaction conflicted; retry",
    status: 409,
  });
});
