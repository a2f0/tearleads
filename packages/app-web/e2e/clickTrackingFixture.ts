import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";

export const privateMarker = "PRIVATE_DOCUMENT_TOKEN";

export const clickTrackingHosts = [
  {
    origin: "https://tearleads.com",
    app: "website",
    environment: "production",
  },
  {
    origin: "https://website-staging.tearleads.com",
    app: "website",
    environment: "staging",
  },
  {
    origin: "https://app.tearleads.com",
    app: "web-app",
    environment: "production",
  },
  {
    origin: "https://app-staging.tearleads.com",
    app: "web-app",
    environment: "staging",
  },
  {
    origin: "https://demo.tearleads.com",
    app: "demo",
    environment: "production",
  },
  {
    origin: "https://demo-staging.tearleads.com",
    app: "demo",
    environment: "staging",
  },
] as const;

export type PrivacySignal =
  | "none"
  | "gpc"
  | "dnt"
  | "extension"
  | "local"
  | "automation";

export async function buildClickTrackingFixture(output: string): Promise<void> {
  for (const [name, entry] of [
    ["website", "../../website/src/clickTracking.ts"],
    ["app", "../src/clickTracking.ts"],
  ] as const) {
    await promisify(execFile)("bun", [
      "build",
      fileURLToPath(new URL(entry, import.meta.url)),
      "--outfile",
      join(output, `${name}.js`),
      "--target",
      "browser",
      "--minify",
    ]);
  }
}

export async function openClickTrackingFixture(
  page: Page,
  output: string,
  origin: string,
  app: string,
  signal: PrivacySignal = "none",
  productionBuild = true,
) {
  const requests: { body: string; headers: Record<string, string> }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((preference) => {
    const pending: Promise<Response>[] = [];
    const fetch = window.fetch.bind(window);
    const trackedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const response = fetch(input, init);
      pending.push(response);
      return response;
    };
    Reflect.set(window, "fetch", trackedFetch);
    Reflect.set(window, "settleClickRequests", () => Promise.all(pending));
    Object.defineProperty(navigator, "webdriver", {
      value: preference === "automation",
      configurable: true,
    });
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: preference === "gpc",
      configurable: true,
    });
    Object.defineProperty(navigator, "doNotTrack", {
      value: preference === "dnt" ? "1" : "0",
      configurable: true,
    });
    if (preference === "local") localStorage.setItem("ct:opt-out", "1");
  }, signal);
  // Every URL, including CT and the synthetic hosted origin, is fulfilled here.
  // No fixture clicks can reach a real collector or application server.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "https://ct.a2f0.net") {
      requests.push({
        body: route.request().postData() ?? "",
        headers: await route.request().allHeaders(),
      });
      await route.fulfill({
        status: 202,
        body: "{}",
        headers: {
          "Access-Control-Allow-Origin": origin,
        },
      });
    } else if (url.pathname === "/tracker.js") {
      await route.fulfill({
        contentType: "text/javascript",
        body: await readFile(
          join(output, `${app === "website" ? "website" : "app"}.js`),
          "utf8",
        ),
      });
    } else {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html>
        <html ${signal === "extension" ? "data-ct-disabled" : ""}>
        <button id="${privateMarker}" title="${privateMarker}">${privateMarker}</button>
        <div id="surface">${privateMarker}</div>
        <a href="/documents/${privateMarker}?token=${privateMarker}" onclick="event.preventDefault()">${privateMarker}</a>
        <input value="${privateMarker}"><textarea>${privateMarker}</textarea>
        <div data-ct-ignore><span id="ignored">Ignored subtree</span></div>
        <div contenteditable="true">${privateMarker}</div>
        <script type="module">
          import { initializeClickTracking } from '/tracker.js';
          initializeClickTracking(${productionBuild});
          initializeClickTracking(${productionBuild});
          document.documentElement.dataset.ready = 'true';
        </script></html>`,
      });
    }
  });
  await page.goto(
    `${origin}/documents/${privateMarker}?token=${privateMarker}#${privateMarker}`,
  );
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-ready") === "true",
  );
  return { requests, errors };
}

export async function flushClickFixture(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("pagehide"));
    // CT starts fetch synchronously from pagehide. Wait for the intercepted
    // response, including headers, so a forbidden request cannot arrive late.
    await Reflect.get(window, "settleClickRequests")();
  });
}
