import { expect, test } from "bun:test";
import {
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES,
} from "@tearleads/validators/util";
import { RequestBodyTooLargeError } from "../validators/requestBodyTooLarge";
import {
  boundRequestBody,
  declaredBodyTooLarge,
  expectedRequestBytes,
  MAX_UNAUTHENTICATED_REQUEST_BYTES,
  requestBodyCeiling,
  requestBodyOverflowed,
  retainUntilDrained,
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
  expect(declaredBodyTooLarge(request, 10)).toBe(true);
  expect(request.bodyUsed).toBe(false);
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
    expect(requestBodyOverflowed(bounded.request)).toBe(false);
    await expect(bounded.request.arrayBuffer()).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
    // The entry can tell the limiter tripped even when the runtime reports
    // the failed read as its own error.
    expect(requestBodyOverflowed(bounded.request)).toBe(true);
  }
});

test("a request without a body passes through", () => {
  const request = new Request("https://api.example.test/");
  expect(boundRequestBody(request, 10)).toEqual({ kind: "request", request });
});

test("document sync keeps its own contract at ingress", () => {
  const route = 64 * 1024 * 1024;
  expect(requestBodyCeiling("/documents/doc-1/sync", route)).toBe(
    MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  );
  expect(requestBodyCeiling("/documents/doc-1/sync", 8)).toBe(8);
  expect(requestBodyCeiling("/documents/doc-1/sync/x", route)).toBe(route);
});

test("an encoded spelling never earns more than the route it reaches", () => {
  const route = 64 * 1024 * 1024;
  // Percent-encoded letters decode to the guest surface.
  expect(requestBodyCeiling("/%61uth/register", route)).toBe(
    MAX_UNAUTHENTICATED_REQUEST_BYTES,
  );
  expect(requestBodyCeiling("/auth%2Fregister", route)).toBe(
    MAX_UNAUTHENTICATED_REQUEST_BYTES,
  );
  // An encoded separator cannot lift the sync contract either way.
  expect(requestBodyCeiling("/documents/doc-1%2Fsync", route)).toBe(
    MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  );
  // A bad escape elsewhere does not hide a decodable route name.
  expect(requestBodyCeiling("/%61uth/sessions/%ZZ", route)).toBe(
    MAX_UNAUTHENTICATED_REQUEST_BYTES,
  );
  expect(requestBodyCeiling("/%61uth/sessions/%E0%A4%A", route)).toBe(
    MAX_UNAUTHENTICATED_REQUEST_BYTES,
  );
  expect(requestBodyCeiling("/containers/%E0%A4%A", route)).toBe(route);
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

test("a request's expected bytes are its declared length, else the ceiling", () => {
  expect(
    expectedRequestBytes(new Request("https://api.example.test/"), "/", 32),
  ).toBe(0);
  expect(
    expectedRequestBytes(
      new Request("https://api.example.test/containers", {
        method: "PUT",
        headers: { "content-length": "12" },
        body: "0123456789ab",
      }),
      "/containers",
      32,
    ),
  ).toBe(12);
  expect(
    expectedRequestBytes(chunkedRequest(["12345"]), "/containers", 32),
  ).toBe(32);
});

test("a document sync pull also reserves the response page it may build", () => {
  const sync = "/documents/doc-1/sync";
  expect(
    expectedRequestBytes(
      new Request("https://api.example.test/documents/doc-1/sync", {
        method: "POST",
        body: "12345",
      }),
      sync,
      16,
    ),
  ).toBe(16 + MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES);
  expect(
    expectedRequestBytes(
      new Request("https://api.example.test/documents/doc-1/sync", {
        method: "POST",
      }),
      sync,
      16,
    ),
  ).toBe(MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES);
  expect(
    expectedRequestBytes(chunkedRequest(["12345"]), "/documents/doc-1", 16),
  ).toBe(16);
});

test("only a sync POST reserves a response page, including encoded routes", () => {
  for (const path of ["/documents/doc-1/sync", "/%64ocuments/doc-1/%73ync"]) {
    for (const method of ["OPTIONS", "GET", "HEAD", "DELETE"]) {
      expect(
        expectedRequestBytes(
          new Request(`https://api.example.test${path}`, {
            method,
          }),
          path,
          16,
        ),
      ).toBe(0);
    }
    expect(
      expectedRequestBytes(
        new Request(`https://api.example.test${path}`, {
          method: "POST",
        }),
        path,
        16,
      ),
    ).toBe(MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES);
  }
});

test("a reservation is released once the response has drained, once", async () => {
  let releases = 0;
  const release = () => {
    releases += 1;
  };
  const drained = retainUntilDrained(
    new Response("0123456789", { status: 200, headers: { "x-a": "b" } }),
    release,
  );
  expect(drained.status).toBe(200);
  expect(drained.headers.get("x-a")).toBe("b");
  expect(releases).toBe(0);
  expect(await drained.text()).toBe("0123456789");
  await Bun.sleep(0);
  expect(releases).toBe(1);

  const canceled = retainUntilDrained(new Response("0123456789"), release);
  await canceled.body?.cancel();
  await Bun.sleep(0);
  expect(releases).toBe(2);

  retainUntilDrained(new Response(null, { status: 204 }), release);
  expect(releases).toBe(3);
});
