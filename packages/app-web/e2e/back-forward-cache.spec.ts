import { expect, type Page, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";

// Playwright keeps every page out of the back/forward cache: the default
// headless shell disables it for its delegate, and the launch passes
// --disable-back-forward-cache. The full Chromium build without that switch
// caches pages the way a browser, or CEF in the desktop app, does.
test.use({
  channel: "chromium",
  launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
});

// What every page posts when it creates a SQLite runtime (see
// evictCachedDatabasePages in @tearleads/sqlite-worker).
const CACHED_PAGE_EVICTION_CHANNEL_NAME =
  "tearleads-sqlite-cached-page-eviction";

async function postEvictionNotice(page: Page): Promise<void> {
  // A receiver in this page hears the notice once the browser has fanned it
  // out to every page holding the channel, the cached one included.
  await page.evaluate(async (channelName) => {
    const sender = new BroadcastChannel(channelName);
    const receiver = new BroadcastChannel(channelName);
    const delivered = new Promise((resolve) => {
      receiver.addEventListener("message", resolve, { once: true });
    });
    sender.postMessage(null);
    await delivered;
    sender.close();
    receiver.close();
  }, CACHED_PAGE_EVICTION_CHANNEL_NAME);
}

test("a page in the back/forward cache is evicted when a later page announces its SQLite runtime", async ({
  context,
  page,
}) => {
  // A cached page is frozen with its SQLite worker, which can still hold the
  // database's OPFS access handles, so the next page's SQLite boot fails until
  // the cache drops the page (#2859).
  const setup = await context.newPage();
  await setup.goto("/app/identity-manager/recovery-key");
  await createFirstIdentity(setup);
  await expect(
    setup.getByRole("button", { name: "Reveal Recovery QR Code" }),
  ).toBeVisible({ timeout: 30_000 });
  await setup.close();

  // Start with an established identity and a ready database. Navigating while
  // first-launch storage is still opening can evict the page for lock contention.
  await page.goto("/app/system-monitor/status");
  await expect(
    page.getByRole("row", { name: /^SQLite Worker ready$/u }),
  ).toBeVisible({ timeout: 30_000 });

  // Worker readiness can precede the last startup responses. Let the page
  // finish loading before freezing it so their callbacks do not race the
  // BroadcastChannel as the cause of eviction.
  await page.waitForLoadState("networkidle");

  // Leave for a same-origin document that runs no app code, so nothing but the
  // notice can evict the cached page.
  await page.goto("/worker.js");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  const notRestoredReasons: string[] = [];
  cdp.on("Page.backForwardCacheNotUsed", (event) => {
    notRestoredReasons.push(
      ...event.notRestoredExplanations.map(({ reason }) => reason),
    );
  });

  await postEvictionNotice(page);
  await page.goBack({ waitUntil: "commit" });

  await expect
    .poll(() => notRestoredReasons)
    .toContain("BroadcastChannelOnMessage");
});
