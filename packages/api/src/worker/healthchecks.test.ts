import { expect, test } from "bun:test";
import { pingHealthcheck, withHealthcheck } from "./healthchecks";

function recordingFetch(status = 200) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init: { readonly method: "POST" }) => {
    calls.push(`${init.method} ${url}`);
    return { ok: status < 400, status };
  };
  return { calls, fetchImpl };
}

test("a successful run pings start then the bare success endpoint", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const result = await withHealthcheck(
    "https://hc.example.test/ping/abc/",
    async () => "done",
    fetchImpl,
  );
  expect(result).toBe("done");
  expect(calls).toEqual([
    "POST https://hc.example.test/ping/abc/start",
    "POST https://hc.example.test/ping/abc",
  ]);
});

test("a failing run pings fail and rethrows", async () => {
  const { calls, fetchImpl } = recordingFetch();
  await expect(
    withHealthcheck(
      "https://hc.example.test/ping/abc",
      async () => {
        throw new Error("sweep failed");
      },
      fetchImpl,
    ),
  ).rejects.toThrow("sweep failed");
  expect(calls).toEqual([
    "POST https://hc.example.test/ping/abc/start",
    "POST https://hc.example.test/ping/abc/fail",
  ]);
});

test("without a configured URL nothing is pinged", async () => {
  const { calls, fetchImpl } = recordingFetch();
  await pingHealthcheck(undefined, "start", fetchImpl);
  await pingHealthcheck("  ", "success", fetchImpl);
  expect(calls).toEqual([]);
});

test("a rejected ping is swallowed so maintenance still runs", async () => {
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  await expect(
    withHealthcheck(
      "https://hc.example.test/ping/abc",
      async () => 1,
      fetchImpl,
    ),
  ).resolves.toBe(1);
});
