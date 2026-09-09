import { expect, type Page } from "@playwright/test";

export const SENTRY_TEST_COMMIT = "c".repeat(40);
export const SENTRY_UPLOAD_TOKEN_SENTINEL = "SYNTHETIC_PRIVATE_UPLOAD_TOKEN";
export const SENTRY_TEST_DSN = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/11`;

export async function observeProductionSentry(page: Page) {
  const bodies: string[] = [];
  await page.route("https://*.sentry.io/**", async (route) => {
    if (route.request().method() === "POST")
      bodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  return async () => {
    const script = await page
      .locator('script[type="module"]')
      .getAttribute("src");
    expect(script).toBeTruthy();
    const scriptUrl = new URL(script ?? "", page.url()).href;
    const source = await (await page.request.get(scriptUrl)).text();
    expect(source).not.toContain(SENTRY_UPLOAD_TOKEN_SENTINEL);
    await page.evaluate((filename) => {
      const error = new Error("SYNTHETIC_PRIVATE_DOCUMENT_CONTENT");
      // A deterministic synthetic code location identifies this probe among
      // any API-offline errors raised by the actual application during boot.
      error.stack = `Error: SYNTHETIC_PRIVATE_DOCUMENT_CONTENT\n    at probe (${filename}:1:4242)`;
      window.dispatchEvent(new ErrorEvent("error", { error }));
    }, scriptUrl);
    await expect
      .poll(() => bodies.some((body) => body.includes('"colno":4242')))
      .toBe(true);
    const body = bodies.find((value) => value.includes('"colno":4242')) ?? "";
    expect(body).not.toContain("SYNTHETIC_PRIVATE_DOCUMENT_CONTENT");
    const event = JSON.parse(body.trim().split("\n")[2] ?? "{}");
    expect(event.release).toBe(`tearleads-web@${SENTRY_TEST_COMMIT}`);
    expect(event.environment).toBe("staging");
    expect(event.dist).toBe("staging-app");
  };
}
