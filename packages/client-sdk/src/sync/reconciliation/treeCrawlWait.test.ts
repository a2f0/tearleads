import { expect, test } from "bun:test";
import { awaitTreeCrawl } from "./treeCrawlWait";

const never = new Promise<boolean>(() => undefined);

test.each([true, false])(
  "a crawl that settles answers %p",
  async (complete) => {
    const stop = new AbortController();
    expect(
      await awaitTreeCrawl(Promise.resolve(complete), stop.signal, 50),
    ).toBe(complete);
  },
);

test("a host with no crawl vouches for nothing", async () => {
  expect(await awaitTreeCrawl(undefined, new AbortController().signal)).toBe(
    false,
  );
});

test("a crawl that never starts stops vouching once the wait is over", async () => {
  const started = performance.now();
  expect(await awaitTreeCrawl(never, new AbortController().signal, 20)).toBe(
    false,
  );
  expect(performance.now() - started).toBeGreaterThanOrEqual(15);
});

test("a stopped sweep does not wait for the crawl", async () => {
  const stop = new AbortController();
  const waiting = awaitTreeCrawl(never, stop.signal, 60_000);
  stop.abort();
  expect(await waiting).toBe(false);

  expect(await awaitTreeCrawl(never, stop.signal, 60_000)).toBe(false);
});

test("a crawl that fails to report rejects the wait", async () => {
  const failure = new Error("port failed");
  await expect(
    awaitTreeCrawl(Promise.reject(failure), new AbortController().signal, 50),
  ).rejects.toBe(failure);
});
