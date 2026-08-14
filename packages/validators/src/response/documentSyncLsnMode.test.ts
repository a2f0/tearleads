import { expect, test } from "bun:test";
import { createSyncResponse } from "../operation/openApiTestFixtures";
import { isDocumentSyncResponse } from "./index";

test("document sync responses declare only supported commit LSN modes", () => {
  const response = createSyncResponse();

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
});
