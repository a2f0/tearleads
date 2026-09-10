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

  const result = await fixture.manage(
    "https://apps.apple.com/account/subscriptions",
  );

  expect(result).toBe("native-closed");
  expect(fixture.nativeCalls).toEqual(["show"]);
  expect(fixture.openedUrls).toEqual([]);
});

test("uses StoreKit when Apple's management URL has a trailing slash", async () => {
  const fixture = setup("ios");

  const result = await fixture.manage(
    "https://apps.apple.com/account/subscriptions/",
  );

  expect(result).toBe("native-closed");
  expect(fixture.nativeCalls).toEqual(["show"]);
  expect(fixture.openedUrls).toEqual([]);
});

test("handles long slash runs in subscription management URLs", async () => {
  const fixture = setup("ios");
  const slashes = "/".repeat(100_000);
  const appleUrl = "https://apps.apple.com/account/subscriptions";
  const externalUrl = `${appleUrl}${slashes}x`;

  expect(await fixture.manage(`${appleUrl}${slashes}`)).toBe("native-closed");
  expect(await fixture.manage(externalUrl)).toBe("external-opened");
  expect(fixture.nativeCalls).toEqual(["show"]);
  expect(fixture.openedUrls).toEqual([externalUrl]);
}, 1_000);

test("uses StoreKit for Apple's locale-prefixed management URL", async () => {
  const fixture = setup("ios");

  const result = await fixture.manage(
    "https://apps.apple.com/us/account/subscriptions",
  );

  expect(result).toBe("native-closed");
  expect(fixture.nativeCalls).toEqual(["show"]);
  expect(fixture.openedUrls).toEqual([]);
});

test("keeps non-Apple provider links manageable from iOS", async () => {
  const fixture = setup("ios");
  const url = "https://play.google.com/store/account/subscriptions";

  const result = await fixture.manage(url);

  expect(result).toBe("external-opened");
  expect(fixture.nativeCalls).toEqual([]);
  expect(fixture.openedUrls).toEqual([url]);
});

test("keeps the provider URL behavior on other platforms", async () => {
  const fixture = setup("android");
  const url = "https://apps.apple.com/account/subscriptions";

  const result = await fixture.manage(url);

  expect(result).toBe("external-opened");
  expect(fixture.nativeCalls).toEqual([]);
  expect(fixture.openedUrls).toEqual([url]);
});

test("does not send malformed provider URLs to StoreKit", async () => {
  const fixture = setup("ios");

  const result = await fixture.manage("not-a-url");

  expect(result).toBe("external-opened");
  expect(fixture.nativeCalls).toEqual([]);
  expect(fixture.openedUrls).toEqual(["not-a-url"]);
});
