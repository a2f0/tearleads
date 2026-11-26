/**
 * How long a catch-up waits for the tree crawl its acknowledged connection
 * owes. The crawl cannot start while the store is not ready or once the
 * socket has dropped again, and nothing reports that, so the wait is bounded:
 * past it nothing vouches for any lane and the catch-up lists them all.
 */
const TREE_CRAWL_WAIT_MS = 15_000;

/**
 * Whether the tree crawl vouches for the lanes it was not served. False when
 * the host reports no crawl, when the crawl does not settle within `waitMs`,
 * and when the sweep is told to stop.
 */
export function awaitTreeCrawl(
  settles: Promise<boolean> | undefined,
  stop: AbortSignal,
  waitMs: number = TREE_CRAWL_WAIT_MS,
): Promise<boolean> {
  if (!settles || stop.aborted) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const finish = (vouched: boolean) => {
      clearTimeout(timer);
      stop.removeEventListener("abort", onStop);
      resolve(vouched);
    };
    const onStop = () => finish(false);
    const timer = setTimeout(() => finish(false), waitMs);
    stop.addEventListener("abort", onStop);
    settles.then(finish, (error: unknown) => {
      clearTimeout(timer);
      stop.removeEventListener("abort", onStop);
      reject(error);
    });
  });
}
