import { expect, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";

// Playwright keeps every page out of the back/forward cache: the default
// headless shell disables it for its delegate, and the launch passes
// --disable-back-forward-cache. The full Chromium build without that switch
// caches pages the way a browser, or CEF in the desktop app, does.
test.use({
  channel: "chromium",
  launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
});

test("a page in the back/forward cache is evicted when a later page announces its SQLite runtime", async ({
  page,
}) => {
  // This page opens the real SQLite database and then stays idle. Background
  // JavaScript in the full app can evict it before the broadcast arrives.
  await page.goto("/e2e/sqlite-runtime");
  await expect(page.getByText("SQLite ready", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  const notRestoredReasons: string[] = [];
  cdp.on("Page.backForwardCacheNotUsed", (event) => {
    notRestoredReasons.push(
      ...event.notRestoredExplanations.map(({ reason }) => reason),
    );
  });

  // Boot the real app on the next page so its SQLite runtime sends the notice.
  await page.goto("/app/identity-manager/recovery-key");
  await createFirstIdentity(page);
  await expect(
    page.getByRole("button", { name: "Reveal Recovery QR Code" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.goBack({ waitUntil: "commit" });

  await expect
    .poll(() => notRestoredReasons)
    .toContain("BroadcastChannelOnMessage");
});
