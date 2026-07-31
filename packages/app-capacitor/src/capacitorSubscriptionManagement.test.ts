import { expect, test } from "bun:test";
import { createCapacitorSubscriptionManagement } from "./capacitorSubscriptionManagement";

function setup(platform: string) {
  const nativeCalls: string[] = [];
  const openedUrls: string[] = [];
  return {
    manage: createCapacitorSubscriptionManagement({
      getPlatform: () => platform,
      openUrl: (url) => openedUrls.push(url),
      showNative: () => {
        nativeCalls.push("show");
        return Promise.resolve();
      },
    }),
    nativeCalls,
    openedUrls,
  };
}

test("uses StoreKit for Apple subscription management on iOS", async () => {
  const fixture = setup("ios");

  await fixture.manage("https://apps.apple.com/account/subscriptions");

  expect(fixture.nativeCalls).toEqual(["show"]);
  expect(fixture.openedUrls).toEqual([]);
});

test("keeps non-Apple provider links manageable from iOS", async () => {
  const fixture = setup("ios");
  const url = "https://play.google.com/store/account/subscriptions";

  await fixture.manage(url);

  expect(fixture.nativeCalls).toEqual([]);
  expect(fixture.openedUrls).toEqual([url]);
});

test("keeps the provider URL behavior on other platforms", async () => {
  const fixture = setup("android");
  const url = "https://apps.apple.com/account/subscriptions";

  await fixture.manage(url);

  expect(fixture.nativeCalls).toEqual([]);
  expect(fixture.openedUrls).toEqual([url]);
});

test("does not send malformed provider URLs to StoreKit", async () => {
  const fixture = setup("ios");

  await fixture.manage("not-a-url");

  expect(fixture.nativeCalls).toEqual([]);
  expect(fixture.openedUrls).toEqual(["not-a-url"]);
});
