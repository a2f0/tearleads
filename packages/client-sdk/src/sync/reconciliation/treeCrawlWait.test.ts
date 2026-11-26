import { expect, test } from "bun:test";
import { createManualReconciliationClock } from "./service.testFixtures";
import { awaitTreeCrawl, TREE_CRAWL_WAIT_MS } from "./treeCrawlWait";

const never = new Promise<boolean>(() => undefined);

test.each([true, false])(
  "a crawl that settles answers %p",
  async (complete) => {
    const clock = createManualReconciliationClock();
    expect(
      await awaitTreeCrawl(
        Promise.resolve(complete),
        new AbortController().signal,
        clock,
      ),
    ).toBe(complete);
  },
);

test("a host with no crawl vouches for nothing", async () => {
  expect(
    await awaitTreeCrawl(
      undefined,
      new AbortController().signal,
      createManualReconciliationClock(),
    ),
  ).toBe(false);
});

test("a crawl that never starts stops vouching once the wait is over", async () => {
  const clock = createManualReconciliationClock();
  let answer: boolean | undefined;
  const waiting = awaitTreeCrawl(
    never,
    new AbortController().signal,
    clock,
  ).then((vouched) => {
    answer = vouched;
  });

  // The wait runs on the reconciler's clock, so a test can drive it.
  clock.advance(TREE_CRAWL_WAIT_MS - 1);
  await Promise.resolve();
  expect(answer).toBeUndefined();

  clock.advance(1);
  await waiting;
  expect(answer).toBe(false);
});

test("a stopped wait does not wait for the crawl", async () => {
  const clock = createManualReconciliationClock();
  const stop = new AbortController();
  const waiting = awaitTreeCrawl(never, stop.signal, clock);
  stop.abort();
  expect(await waiting).toBe(false);

  expect(await awaitTreeCrawl(never, stop.signal, clock)).toBe(false);
});

test("a crawl that fails to report rejects the wait", async () => {
  const failure = new Error("port failed");
  await expect(
    awaitTreeCrawl(
      Promise.reject(failure),
      new AbortController().signal,
      createManualReconciliationClock(),
    ),
  ).rejects.toBe(failure);
});
