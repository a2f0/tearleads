import { expect, type Page, type Response, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";
import {
  installRecoveryQrCamera,
  pointCameraAtRecoveryQr,
  showRecoveryQr,
} from "./recoveryQrCamera";
import { SIGNED_IN_API_URL, SIGNED_IN_APP_URL } from "./signedInServer";

/*
 * A phone that resets and restores its identity from the recovery QR lists
 * its folders before their names arrive: sync pulls each folder's details
 * once the listing settles. Explorer used to treat that gap as settled and
 * told the user "Folder details unavailable — Refresh Explorer when you're
 * online" while it was online and still syncing. Each step waits for the
 * screen or API response that proves it landed; a mobile-like round trip
 * stretches the gap, and an observer records whether the panel was ever
 * drawn, however briefly.
 */

const FOLDER = "Field Notes";
const UNAVAILABLE = "Folder details unavailable";

test.use({
  baseURL: SIGNED_IN_APP_URL,
  viewport: { width: 390, height: 844 },
});

function apiResponse(
  page: Page,
  method: string,
  pathname: RegExp,
): Promise<Response> {
  return page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === SIGNED_IN_API_URL &&
        response.request().method() === method &&
        pathname.test(url.pathname) &&
        response.status() === 200
      );
    },
    { timeout: 60_000 },
  );
}

async function createFolder(page: Page): Promise<void> {
  const create = page.getByRole("button", {
    name: "Create Child Folder",
    exact: true,
  });
  await expect(create).toBeEnabled({ timeout: 60_000 });
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create Child Folder" });
  await dialog.getByRole("textbox", { name: "Container name" }).fill(FOLDER);
  const created = apiResponse(
    page,
    "POST",
    /^\/containers\/with-metadata-document$/u,
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await created;
  await expect(
    page
      .getByRole("button", { name: "All changes synced", exact: true })
      .first(),
  ).toBeVisible({ timeout: 60_000 });
}

async function resetDevice(page: Page): Promise<void> {
  await page.goto("/app/identity-manager/local-data");
  await page.getByRole("button", { name: "Reset Device" }).first().click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("textbox").fill("reset device");
  await confirm.getByRole("button", { name: "Reset Device" }).click();
}

test("a restored phone syncs its folders without calling them unavailable", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const loggedIn = apiResponse(page, "POST", /^\/auth\/verify$/u);
  await page.goto("/app/explorer");
  await createFirstIdentity(page);
  await loggedIn;
  await createFolder(page);
  await page.goto("/app/identity-manager/recovery-key");
  const qr = await showRecoveryQr(page);

  // The reset reloads the page, so the observer is installed on every load
  // and only the restored session's record is read.
  await page.addInitScript((text) => {
    const record = { seen: false };
    Reflect.set(window, "folderUnavailableRecord", record);
    new MutationObserver(() => {
      if (!record.seen && document.body?.innerText.includes(text)) {
        record.seen = true;
      }
    }).observe(document, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  }, UNAVAILABLE);
  await resetDevice(page);
  const restore = page
    .getByRole("button", { name: "Restore identity", exact: true })
    .first();
  await expect(restore).toBeVisible({ timeout: 60_000 });

  const network = await page.context().newCDPSession(page);
  await network.send("Network.enable");
  await network.send("Network.emulateNetworkConditions", {
    downloadThroughput: 200_000,
    latency: 300,
    offline: false,
    uploadThroughput: 100_000,
  });
  await restore.click();
  await installRecoveryQrCamera(page, qr, { blank: true });
  await page
    .getByRole("button", { name: "Restore from QR code" })
    .first()
    .click();
  await pointCameraAtRecoveryQr(page);
  await expect(page.getByLabel("Recovery QR code camera")).toHaveCount(0, {
    timeout: 30_000,
  });

  // Opened in place, as a tap would, so the restored session keeps running.
  await page.evaluate(() => {
    history.pushState({}, "", "/app/explorer");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByRole("button", { name: FOLDER, exact: true }).first(),
  ).toBeVisible({ timeout: 90_000 });
  expect(
    await page.evaluate(
      () =>
        Reflect.get(Reflect.get(window, "folderUnavailableRecord"), "seen") ===
        true,
    ),
  ).toBe(false);
});
