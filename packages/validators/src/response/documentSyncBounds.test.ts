import { expect, test } from "bun:test";
import { createSyncResponse } from "../operation/openApiTestFixtures";
import { MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES } from "../util";
import { DocumentSyncResponseSchema } from "./documentSyncSchema";

test("document sync responses reject more than one bounded update page", () => {
  const response = createSyncResponse();
  const update = response.updates[0];
  if (!update) throw new Error("Expected a document sync update fixture");
  const updates = Array.from(
    { length: MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES + 1 },
    (_, index) => ({ ...update, id: `${update.id}-${index}` }),
  );

  expect(
    DocumentSyncResponseSchema.safeParse({
      ...response,
      pullPage: { hasMore: false, nextCursor: null },
      updates,
    }).success,
  ).toBe(false);
});
