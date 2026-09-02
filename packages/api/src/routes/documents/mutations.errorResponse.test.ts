import { expect, test } from "bun:test";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { documentSyncErrorBody } from "./mutations";

test("sync state-stale responses carry principal-policy repair bundles", () => {
  expect(
    documentSyncErrorBody({
      code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
      details: { principalPolicies: [] },
      error: "Principal policy is stale",
      status: 409,
    }),
  ).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    error: "Principal policy is stale",
    principalPolicies: [],
  });
});

test("uncoded sync conflicts stay terminal", () => {
  expect(
    documentSyncErrorBody({
      code: undefined,
      details: undefined,
      error: "Terminal conflict",
      status: 409,
    }),
  ).toEqual({
    code: DOCUMENT_SYNC_ERROR_CODES.conflict,
    error: "Terminal conflict",
  });
});
