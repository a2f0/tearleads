import { expect, test } from "bun:test";
import {
  createContainerMutation,
  createSyncRequest,
} from "../operation/openApiTestFixtures";
import { isDocumentSyncRequest } from "./index";

test("inline rekey markers accompany exactly nonempty rekey batches", () => {
  const {
    containerRekeys: _rekeys,
    inlineRekeyCommitId: _marker,
    ...request
  } = createSyncRequest();
  expect(
    isDocumentSyncRequest({
      ...request,
      containerRekeys: [createContainerMutation()],
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({ ...request, inlineRekeyCommitId: "a".repeat(64) }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...request,
      containerRekeys: [],
      inlineRekeyCommitId: "a".repeat(64),
    }),
  ).toBe(false);
  expect(
    isDocumentSyncRequest({
      ...request,
      containerRekeys: [createContainerMutation()],
      inlineRekeyCommitId: "a".repeat(64),
    }),
  ).toBe(true);
});
