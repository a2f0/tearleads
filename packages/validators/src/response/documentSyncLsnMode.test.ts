import { expect, test } from "bun:test";
import { createSyncResponse } from "../operation/openApiTestFixtures";
import { isDocumentSyncResponse } from "./index";

test("document sync responses declare only supported commit LSN modes", () => {
  const response = createSyncResponse();
  expect(
    isDocumentSyncResponse({ ...response, commitLsnMode: undefined }),
  ).toBe(false);
  expect(
    isDocumentSyncResponse({ ...response, commitLsnMode: "tracked" }),
  ).toBe(true);

  expect(
    isDocumentSyncResponse({
      ...response,
      commitLsn: "0/0",
      commitLsnMode: "untracked",
    }),
  ).toBe(true);
  expect(
    isDocumentSyncResponse({
      ...response,
      commitLsnMode: "unknown",
    }),
  ).toBe(false);
  for (const commitLsn of [null, "0/1"]) {
    expect(
      isDocumentSyncResponse({
        ...response,
        commitLsn,
        commitLsnMode: "untracked",
      }),
    ).toBe(false);
  }
  for (const commitLsnMode of [undefined, "tracked"]) {
    expect(
      isDocumentSyncResponse({
        ...response,
        commitLsn: "0/0",
        commitLsnMode,
      }),
    ).toBe(false);
  }
});
