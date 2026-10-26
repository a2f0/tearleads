import { expect, mock, spyOn, test } from "bun:test";
import { collectSamples } from "./client";

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
