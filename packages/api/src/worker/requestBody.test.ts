import { expect, test } from "bun:test";
import { boundRequestBody } from "./requestBody";

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
  // Bun's RequestInit type omits the standard duplex field a streamed body needs.
  const init: RequestInit & { readonly duplex: "half" } = {
    method: "PUT",
    body,
    duplex: "half",
  };
  return new Request("https://api.example.test/upload", init);
}

test("a declared length above the ceiling is refused without reading", async () => {
  const request = new Request("https://api.example.test/upload", {
    method: "PUT",
    headers: { "content-length": "11" },
    body: "0123456789a",
  });
  expect(await boundRequestBody(request, 10)).toEqual({ kind: "too-large" });
});

test("a declared length within the ceiling passes the request through untouched", async () => {
  const request = new Request("https://api.example.test/upload", {
    method: "PUT",
    headers: { "content-length": "5" },
    body: "hello",
  });
  const bounded = await boundRequestBody(request, 10);
  expect(bounded.kind).toBe("request");
  if (bounded.kind === "request") {
    expect(bounded.request).toBe(request);
  }
});

test("a chunked body is buffered up to the ceiling and then refused", async () => {
  const request = chunkedRequest(["12345", "67890", "x"]);
  request.headers.delete("content-length");
  expect(await boundRequestBody(request, 10)).toEqual({ kind: "too-large" });
});

test("a chunked body within the ceiling reaches the route with its length", async () => {
  const request = chunkedRequest(["12345", "678"]);
  request.headers.delete("content-length");
  const bounded = await boundRequestBody(request, 10);
  expect(bounded.kind).toBe("request");
  if (bounded.kind === "request") {
    expect(bounded.request.headers.get("content-length")).toBe("8");
    expect(await bounded.request.text()).toBe("12345678");
  }
});

test("a request without a body passes through", async () => {
  const request = new Request("https://api.example.test/");
  const bounded = await boundRequestBody(request, 10);
  expect(bounded).toEqual({ kind: "request", request });
});
