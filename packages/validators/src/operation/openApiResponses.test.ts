import { expect, test } from "bun:test";
import { documentSyncOperation } from "./documentSync";
import { createOpenApiDocument } from "./openApi";

test("OpenAPI generation rejects overlapping empty response metadata", () => {
  expect(() =>
    createOpenApiDocument([
      { ...documentSyncOperation, emptyResponseStatuses: [200] },
    ]),
  ).toThrow("documents.sync declares status 200 twice");
  expect(() =>
    createOpenApiDocument([
      { ...documentSyncOperation, emptyResponseStatuses: [204, 204] },
    ]),
  ).toThrow("documents.sync repeats an empty response status");
});
