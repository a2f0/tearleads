import { expect, test } from "bun:test";
import {
  getDocumentAttributionOperation,
  listDocumentAttributionRangesOperation,
} from "@symcrypt/validators/operation";
import {
  getDocumentAttribution,
  listDocumentAttributionRanges,
} from "./attributionRequests";

test("document attribution client metadata derives from shared operations", () => {
  expect(getDocumentAttribution).toMatchObject({
    method: getDocumentAttributionOperation.method,
  });
  expect(getDocumentAttribution.path("document/1")).toBe(
    "/documents/document%2F1/attribution",
  );
  expect(listDocumentAttributionRanges).toMatchObject({
    method: listDocumentAttributionRangesOperation.method,
  });
  expect(
    listDocumentAttributionRanges.path("document/1", {
      cursor: "page one",
      expectedRevision: 7,
      limit: 25,
    }),
  ).toBe(
    "/documents/document%2F1/attribution/ranges?cursor=page+one&expectedRevision=7&limit=25",
  );
  expect(
    listDocumentAttributionRanges.path("document/1", { cursor: null }),
  ).toBe("/documents/document%2F1/attribution/ranges");
});
