import { expect, test } from "bun:test";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import {
  isContainerManifestAlreadyExistsConflict,
  isStaleParentContainerPathFailure,
} from "./mutationFailures";
import type { ContainerMutationSubmitFailure } from "./types";

function failure(
  code: string | undefined,
  message: string,
  status = 409,
): ContainerMutationSubmitFailure {
  return {
    ...(code === undefined ? {} : { code }),
    message,
    ok: false,
    report: () => undefined,
    status,
  };
}

test("container stale-parent replans require exact behavior codes", () => {
  expect(
    isStaleParentContainerPathFailure(
      failure(CONTAINER_MUTATION_ERROR_CODES.stateStale, "Diagnostic changed"),
    ),
  ).toBe(true);
  expect(
    isStaleParentContainerPathFailure(
      failure(DOCUMENT_SYNC_ERROR_CODES.stateStale, "Diagnostic changed"),
    ),
  ).toBe(true);
  expect(
    isStaleParentContainerPathFailure(
      failure(undefined, "parentContainerPath[0] manifest head is stale"),
    ),
  ).toBe(false);
  expect(
    isStaleParentContainerPathFailure(
      failure("unknown_code", "parentContainerPath[0] manifest head is stale"),
    ),
  ).toBe(false);
  expect(
    isStaleParentContainerPathFailure(
      failure(` ${CONTAINER_MUTATION_ERROR_CODES.stateStale} `, "Diagnostic"),
    ),
  ).toBe(false);
  expect(
    isStaleParentContainerPathFailure(
      failure(CONTAINER_MUTATION_ERROR_CODES.stateStale, "Diagnostic", 503),
    ),
  ).toBe(false);
});

test("container lost-response adoption requires exact behavior codes", () => {
  expect(
    isContainerManifestAlreadyExistsConflict(
      failure(
        CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists,
        "Diagnostic changed",
      ),
    ),
  ).toBe(true);
  expect(
    isContainerManifestAlreadyExistsConflict(
      failure(
        DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists,
        "Diagnostic changed",
      ),
    ),
  ).toBe(true);
  expect(
    isContainerManifestAlreadyExistsConflict(
      failure(undefined, "Container manifest already exists"),
    ),
  ).toBe(false);
  expect(
    isContainerManifestAlreadyExistsConflict(
      failure("unknown_code", "Document manifest already exists"),
    ),
  ).toBe(false);
  expect(
    isContainerManifestAlreadyExistsConflict(
      failure(
        CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists,
        "Diagnostic",
        500,
      ),
    ),
  ).toBe(false);
});
