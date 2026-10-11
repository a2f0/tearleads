import { expect, test } from "bun:test";
import { boundRequestBody, RequestBodyTooLargeError } from "./requestBody";

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
