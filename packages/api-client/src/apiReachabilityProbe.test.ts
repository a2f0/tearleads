import { expect, mock, test } from "bun:test";
import { createApiReachabilityProbe } from "./apiReachabilityProbe";

function fetchStub(
  respond: () => Promise<Response>,
): typeof globalThis.fetch & { calls: Array<[string, RequestInit]> } {
  const calls: Array<[string, RequestInit]> = [];
  const stub = mock(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([String(input), init ?? {}]);
      return respond();
    },
  );
  return Object.assign(stub, { calls, preconnect: () => undefined });
}

test("probes the API origin root with a credential-free no-cors HEAD", async () => {
  const fetch = fetchStub(async () => new Response(null, { status: 404 }));
  const probe = createApiReachabilityProbe({ fetch });
  expect(await probe("https://api.example.test")).toBe("reachable");
  expect(fetch.calls).toHaveLength(1);
  const [url, init] = fetch.calls[0] ?? ["", {}];
  expect(url).toBe("https://api.example.test/");
  expect(init).toMatchObject({
    cache: "no-store",
    credentials: "omit",
    method: "HEAD",
    mode: "no-cors",
    referrerPolicy: "no-referrer",
  });
  expect(init.headers).toBeUndefined();
  expect(init.body).toBeUndefined();
});

test("a rejected probe reports the host unreachable", async () => {
  const fetch = fetchStub(async () => {
    throw new TypeError("Failed to fetch");
  });
  expect(await createApiReachabilityProbe({ fetch })("https://a.test")).toBe(
    "unreachable",
  );
});

test("a probe that never answers times out as unreachable", async () => {
  const fetch = fetchStub(() => new Promise<Response>(() => {}));
  const probe = createApiReachabilityProbe({ fetch, timeoutMs: 5 });
  expect(await probe("https://a.test")).toBe("unreachable");
});

test("a burst of failures shares one probe per origin until it expires", async () => {
  let nowMs = 0;
  const fetch = fetchStub(async () => new Response(null));
  const probe = createApiReachabilityProbe({
    cacheMs: 1_000,
    fetch,
    now: () => nowMs,
  });
  await Promise.all([probe("https://a.test"), probe("https://a.test")]);
  nowMs = 999;
  await probe("https://a.test");
  expect(fetch.calls).toHaveLength(1);
  await probe("https://b.test");
  expect(fetch.calls).toHaveLength(2);
  nowMs = 1_000;
  await probe("https://a.test");
  expect(fetch.calls).toHaveLength(3);
});
