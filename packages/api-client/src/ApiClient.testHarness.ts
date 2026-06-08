import { test } from "bun:test";
import { setupServer } from "msw/node";

export const apiBaseUrl = "http://api.test";
export const server = setupServer();

export interface CapturedHttpCall {
  readonly authorization: string | null;
  readonly body: string | null;
  readonly contentType: string | null;
  readonly method: string;
  readonly url: string;
}

server.listen({ onUnhandledRequest: "error" });

let apiClientTestQueue = Promise.resolve();

export function testApiClient(
  name: string,
  run: () => Promise<void> | void,
): void {
  test(name, async () => {
    const previous = apiClientTestQueue;
    let release!: () => void;
    apiClientTestQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      server.resetHandlers();
      await run();
    } finally {
      server.resetHandlers();
      release();
    }
  });
}

export async function captureHttpCall(
  request: Request,
): Promise<CapturedHttpCall> {
  return {
    authorization: request.headers.get("authorization"),
    body:
      request.method === "GET" || request.method === "HEAD"
        ? null
        : await request.clone().text(),
    contentType: request.headers.get("content-type"),
    method: request.method,
    url: request.url,
  };
}

export function textStream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
