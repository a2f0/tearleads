import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  buildClickTrackingFixture,
  clickTrackingHosts,
  flushClickFixture,
  openClickTrackingFixture,
  privateMarker,
} from "./clickTrackingFixture";

let output: string;
test.beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), "tearleads-click-browser-"));
  await buildClickTrackingFixture(output);
});
test.afterAll(async () => {
  await rm(output, { recursive: true, force: true });
});

for (const host of clickTrackingHosts) {
  test(`${host.origin} attributes trusted clicks without private metadata`, async ({
    page,
  }) => {
    const { requests, errors } = await openClickTrackingFixture(
      page,
      output,
      host.origin,
      host.app,
    );
    await page.locator("button").evaluate((element) => element.click());
    await page.locator("input").click();
    await page.locator("textarea").click();
    await page.locator("#ignored").click();
    await page.locator("[contenteditable]").click();
    await flushClickFixture(page);
    expect(requests).toEqual([]);
    await page.locator("button").click();
    await page.locator("#surface").click();
    await flushClickFixture(page);
    await expect.poll(() => requests.length).toBe(1);
    const request = requests[0];
    expect(request?.body).not.toContain(privateMarker);
    expect(request?.headers.referer).toBeUndefined();
    expect(request?.headers.cookie).toBeUndefined();
    const body = JSON.parse(request?.body ?? "{}");
    expect(body.site).toBe("tearleads");
    expect(body.environment).toBe(host.environment);
    expect(body.events).toHaveLength(2);
    for (const [index, target] of ["button", "div"].entries()) {
      expect(body.events[index]).toEqual({
        id: expect.any(String),
        timestamp: expect.any(Number),
        page: "/",
        target,
        app: host.app,
        label: null,
      });
    }
    expect(errors).toEqual([]);
  });

  for (const signal of [
    "gpc",
    "dnt",
    "extension",
    "local",
    "automation",
  ] as const) {
    test(`${host.origin} honors ${signal}`, async ({ page }) => {
      const { requests, errors } = await openClickTrackingFixture(
        page,
        output,
        host.origin,
        host.app,
        signal,
      );
      await page.locator("button").click();
      await flushClickFixture(page);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test(`${host.origin} discards queued clicks when privacy changes`, async ({
    page,
  }) => {
    const { requests, errors } = await openClickTrackingFixture(
      page,
      output,
      host.origin,
      host.app,
    );
    await page.locator("button").click();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "globalPrivacyControl", { value: true }),
    );
    await flushClickFixture(page);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "globalPrivacyControl", {
        value: false,
      }),
    );
    await flushClickFixture(page);
    expect(requests).toEqual([]);
  });

  test(`${host.origin} remains inert in development`, async ({ page }) => {
    const { requests, errors } = await openClickTrackingFixture(
      page,
      output,
      host.origin,
      host.app,
      "none",
      false,
    );
    await page.locator("button").click();
    await flushClickFixture(page);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const app of ["website", "web-app"]) {
  for (const origin of [
    "http://localhost:3100",
    "https://preview.tearleads.com",
    "http://app.tearleads.com",
    "https://app.tearleads.com:444",
  ]) {
    test(`${app} ignores unregistered origin ${origin}`, async ({ page }) => {
      const { requests, errors } = await openClickTrackingFixture(
        page,
        output,
        origin,
        app,
      );
      await page.locator("button").click();
      await flushClickFixture(page);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
