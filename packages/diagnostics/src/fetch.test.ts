import { expect, spyOn, test } from "bun:test";
import { fetchWithTimeout } from "./fetch";

test("timeouts work without AbortSignal.timeout even when the native bridge ignores abort", async () => {
  let signal: AbortSignal | null | undefined;
  const modernTimeout = spyOn(AbortSignal, "timeout").mockImplementation(() => {
    throw new Error("Unavailable on iOS 15");
  });
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>(() => {});
      },
      { preconnect: () => {} },
    ),
  );
  try {
    await expect(
      fetchWithTimeout("https://sentry.invalid", {}, 5),
    ).rejects.toThrow("Diagnostics request timed out");
    expect(signal?.aborted).toBe(true);
    expect(modernTimeout).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    modernTimeout.mockRestore();
  }
});

test("successful requests retain privacy options and clear the timeout", async () => {
  let options: RequestInit | undefined;
  const network = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        options = init;
        return new Response(null, { status: 200 });
      },
      { preconnect: () => {} },
    ),
  );
  try {
    const response = await fetchWithTimeout(
      "https://sentry.invalid",
      { credentials: "omit", referrerPolicy: "no-referrer", keepalive: true },
      5,
    );
    expect(response.status).toBe(200);
    await Bun.sleep(10);
    expect(options?.signal?.aborted).toBe(false);
    expect(options).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
    });
  } finally {
    network.mockRestore();
  }
});
