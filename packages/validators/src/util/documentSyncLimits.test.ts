import { expect, test } from "bun:test";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "./blob";
import {
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES,
  MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES,
} from "./documentSyncLimits";

const WORKERS_ISOLATE_BYTES = 128 * 1024 * 1024;

test("a response page still carries the largest accepted rotation baseline", () => {
  expect(MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES).toBeGreaterThanOrEqual(
    MAX_MULTIPART_BLOB_PART_BYTES,
  );
});

test("a materialized page and its serialized copy fit the Workers isolate", () => {
  // The pull workflow holds the page's entries and the JSON it writes at the
  // same time; the remainder is left for the runtime and the request itself.
  expect(2 * MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES).toBeLessThanOrEqual(
    (WORKERS_ISOLATE_BYTES * 3) / 4,
  );
});
