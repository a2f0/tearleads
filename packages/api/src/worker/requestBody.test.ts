import { expect, test } from "bun:test";
import { RequestBodyTooLargeError } from "../validators/requestBodyTooLarge";
import {
  boundRequestBody,
  MAX_UNAUTHENTICATED_REQUEST_BYTES,
  requestBodyCeiling,
} from "./requestBody";

function chunkedRequest(chunks: readonly string[]): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  const init: RequestInit & { readonly duplex: "half" } = {
    method: "PUT",
    body,
    duplex: "half",
  };
  return new Request("https://api.example.test/upload", init);
}

test("a declared length above the ceiling is refused without reading", () => {
  const request = new Request("https://api.example.test/upload", {
    method: "PUT",
    headers: { "content-length": "11" },
    body: "0123456789a",
  });
  expect(boundRequestBody(request, 10)).toEqual({ kind: "too-large" });
});

test("a body within the ceiling reaches the route intact", async () => {
  const bounded = boundRequestBody(chunkedRequest(["12345", "678"]), 10);
  expect(bounded.kind).toBe("request");
  if (bounded.kind === "request") {
    expect(await bounded.request.text()).toBe("12345678");
  }
});

test("a body past the ceiling fails the route's read, not the ingress", async () => {
  const bounded = boundRequestBody(chunkedRequest(["12345", "67890", "x"]), 10);
  expect(bounded.kind).toBe("request");
  if (bounded.kind === "request") {
    await expect(bounded.request.arrayBuffer()).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  }
});

test("a request without a body passes through", () => {
  const request = new Request("https://api.example.test/");
  expect(boundRequestBody(request, 10)).toEqual({ kind: "request", request });
});

test("the unauthenticated surface gets the small ceiling, every session route the route ceiling", () => {
  const route = 32;
  for (const path of [
    "/",
    "/auth/register",
    "/auth/challenge",
    "/auth/verify",
    "/billing/stripe/webhook",
    "/billing/revenuecat/webhook",
  ]) {
    expect(requestBodyCeiling(path, route)).toBe(
      MAX_UNAUTHENTICATED_REQUEST_BYTES,
    );
  }
  for (const path of [
    "/blobs/stages/multipart/stage-1/parts/3/bytes",
    "/documents",
    "/documents/doc-1/link",
    "/documents/doc-1/sync",
    "/containers/with-metadata-document",
    // Rotations carry a keyring entry per member and can exceed 5 MiB.
    "/containers/c-1/revoke",
    "/containers/c-1/rekey",
    "/containers/c-1/move",
    "/organizations/org-1/billing/stripe/checkout",
    "/authx",
  ]) {
    expect(requestBodyCeiling(path, route)).toBe(route);
  }
});
