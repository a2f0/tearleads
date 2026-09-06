import { expect, test } from "bun:test";
import {
  documentSyncIntentCounts,
  proxiedApiBodyBytes,
} from "../../../../test/helpers/proxiedApiRequestMetrics";
import { recordProxiedApiResponse } from "../../../../test/helpers/proxiedApiResponse";

test("records byte lengths and preserves non-UTF8 responses", async () => {
  const body = new TextEncoder().encode("é🙂");
  const binary = Uint8Array.of(0, 255, 128, 65);
  const { record, responseBytes } = await recordProxiedApiResponse({
    request: new Request("https://example.test/blobs/blob/bytes", {
      method: "POST",
      body,
    }),
    requestBody: body.buffer,
    response: new Response(binary),
  });
  expect(record.requestBody).toBe("é🙂");
  expect(record.requestBodyBytes).toBe(6);
  expect(record.responseBodyBytes).toBe(4);
  expect(new Uint8Array(responseBytes)).toEqual(binary);
  expect(proxiedApiBodyBytes([record, record])).toEqual({
    request: 12,
    response: 8,
  });
});

test("sync intent classification rejects missing bodies instead of calling them probes", async () => {
  const request = new Request("https://example.test/documents/id/sync", {
    method: "POST",
  });
  const { record } = await recordProxiedApiResponse({
    request,
    requestBody: null,
    response: new Response(),
  });
  const probe = {
    ...record,
    requestBody: JSON.stringify({ outgoingUpdates: [] }),
  };
  const write = {
    ...record,
    requestBody: JSON.stringify({ outgoingUpdates: [{}] }),
  };
  expect(documentSyncIntentCounts([probe, write])).toEqual({
    readOnly: 1,
    writeBearing: 1,
  });
  expect(() => documentSyncIntentCounts([record])).toThrow(
    "without outgoingUpdates",
  );
  expect(() =>
    documentSyncIntentCounts([{ ...record, requestBody: "{}" }]),
  ).toThrow("without outgoingUpdates");
});
