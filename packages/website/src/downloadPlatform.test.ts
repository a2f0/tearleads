import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { promoteVisitorDownload } from "./downloadPlatform";

// The DOM is registered for this file only; other website tests use Bun's own
// fetch and Response, so the globals are restored after (as in SiteNav.test).
GlobalRegistrator.register();

afterEach(() => {
  document.body.replaceChildren();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const BUILT_ORDER = ["macos", "linux", "windows", "ios", "android", "web"];

function renderList(platforms: readonly string[]): HTMLUListElement {
  const list = document.createElement("ul");
  for (const platform of platforms) {
    const row = document.createElement("li");
    row.dataset.downloadPlatform = platform;
    list.append(row);
  }
  document.body.append(list);
  return list;
}

function orderFor(
  visitor: Parameters<typeof promoteVisitorDownload>[1],
  platforms: readonly string[] = BUILT_ORDER,
): (string | null)[] {
  const list = renderList(platforms);
  promoteVisitorDownload(document, visitor);
  const order = [...list.children].map((row) =>
    row.getAttribute("data-download-platform"),
  );
  list.remove();
  return order;
}

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0";
const UBUNTU_FIREFOX =
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0";
const LINUX_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const CHROMEOS =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

test("phones see their own store row first, ahead of the desktop rows", () => {
  expect(orderFor({ userAgent: ANDROID_CHROME, maxTouchPoints: 5 })).toEqual([
    "android",
    "macos",
    "linux",
    "windows",
    "ios",
    "web",
  ]);
  expect(orderFor({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5 })).toEqual([
    "ios",
    "macos",
    "linux",
    "windows",
    "android",
    "web",
  ]);
});

test("an iPad sending the Mac user agent gets iOS; a Mac keeps macOS", () => {
  expect(orderFor({ userAgent: MAC_SAFARI, maxTouchPoints: 5 })[0]).toBe("ios");
  expect(orderFor({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toEqual(
    BUILT_ORDER,
  );
});

test("desktop visitors see their own installer first", () => {
  expect(orderFor({ userAgent: WINDOWS_EDGE, maxTouchPoints: 0 })[0]).toBe(
    "windows",
  );
  expect(orderFor({ userAgent: UBUNTU_FIREFOX, maxTouchPoints: 0 })[0]).toBe(
    "linux",
  );
});

test("Chromium's platform hint beats a requested desktop user agent", () => {
  const desktopModeAndroid = {
    userAgent: LINUX_CHROME,
    maxTouchPoints: 5,
    userAgentData: { platform: "Android" },
  };
  expect(orderFor(desktopModeAndroid)[0]).toBe("android");
});

test("platforms without a row keep the built order", () => {
  expect(orderFor({ userAgent: CHROMEOS, maxTouchPoints: 0 })).toEqual(
    BUILT_ORDER,
  );
  const withoutWindows = BUILT_ORDER.filter((id) => id !== "windows");
  expect(
    orderFor({ userAgent: WINDOWS_EDGE, maxTouchPoints: 0 }, withoutWindows),
  ).toEqual(withoutWindows);
});
