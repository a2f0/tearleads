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
      pullPage: {
        hasMore: false,
        nextCursor: null,
        throughUpdateCount: 0,
        throughUpdateId: null,
      },
      updates,
    }).success,
  ).toBe(false);
});

test("document sync responses require a consistent pull continuation", () => {
  const response = createSyncResponse();
  expect(
    DocumentSyncResponseSchema.safeParse({
      ...response,
      pullPage: {
        hasMore: true,
        nextCursor: "next-page",
        throughUpdateCount: 0,
        throughUpdateId: null,
      },
    }).success,
  ).toBe(true);
  expect(
    DocumentSyncResponseSchema.safeParse({
      ...response,
      pullPage: {
        hasMore: false,
        nextCursor: "next-page",
        throughUpdateCount: 0,
        throughUpdateId: null,
      },
    }).success,
  ).toBe(false);
});

test("a pull page names an upper bound exactly when it counts updates", () => {
  const response = createSyncResponse();
  const page = (throughUpdateCount: number, throughUpdateId: string | null) =>
    DocumentSyncResponseSchema.safeParse({
      ...response,
      pullPage: {
        hasMore: false,
        nextCursor: null,
        throughUpdateCount,
        throughUpdateId,
      },
    }).success;
  const bound = "22222222-2222-4222-8222-222222222222";
  expect(page(0, null)).toBe(true);
  expect(page(3, bound)).toBe(true);
  expect(page(1, null)).toBe(false);
  expect(page(0, bound)).toBe(false);
  expect(page(-1, null)).toBe(false);
});
