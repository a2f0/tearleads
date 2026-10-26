import { expect, mock, spyOn, test } from "bun:test";
import { collectSamples } from "./client";
import { createCloudflareApi } from "./cloudflareApi";
import { cloudflareFailure } from "./cloudflareErrors";

test("a failed measurement is never retried and refuses redirects", async () => {
  const transport = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 503 }),
  );
  const onSample = mock(async () => {});
  try {
    await expect(
      collectSamples({
        origin: "https://probe.test",
        headers: {},
        runId: "run",
        count: 3,
        signal: new AbortController().signal,
        onSample,
      }),
    ).rejects.toThrow("no sample retry");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[1]?.redirect).toBe("error");
    expect(onSample).not.toHaveBeenCalled();
  } finally {
    transport.mockRestore();
  }
});

test("Cloudflare credentials stay on its API and API error bodies are not exposed", async () => {
  const transport = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("private-response", { status: 403 }),
  );
  try {
    const api = createCloudflareApi({
      account: "a".repeat(32),
      token: "private-token",
      fetch: globalThis.fetch,
    });
    await expect(api("/workers/subdomain")).rejects.toThrow("HTTP 403");
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(String(url)).toStartWith(
      "https://api.cloudflare.com/client/v4/accounts/",
    );
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer private-token",
    );
  } finally {
    transport.mockRestore();
  }
});

test("provider diagnostics redact both API credentials and uploaded probe secrets", async () => {
  const body = new FormData();
  body.set(
    "metadata",
    JSON.stringify({
      bindings: [{ type: "secret_text", text: "probe-secret" }],
    }),
  );
  const response = Response.json(
    {
      errors: [
        { code: 10021, message: "Invalid placement api-token probe-secret" },
      ],
      unrelated: "must not be logged",
    },
    { status: 400 },
  );
  const message = await cloudflareFailure(response, "api-token", body);
  expect(message).toBe("10021: Invalid placement [redacted] [redacted]");
});
