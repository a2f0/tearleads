import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import packageJson from "../package.json" with { type: "json" };
import { cjkPdf, uploadAndOpenPdf } from "./pdfFixtures";
import {
  observeProductionSentry,
  SENTRY_TEST_COMMIT,
  SENTRY_TEST_DSN,
  SENTRY_UPLOAD_TOKEN_SENTINEL,
} from "./productionSentryAssertions";

const appDir = fileURLToPath(new URL("../", import.meta.url));
const contentTypes: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};

async function assertDemoLayout(page: Page): Promise<void> {
  await expect(page.locator(".layout--demo-peer-split")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch to windowed layout" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Switch to iPad / mobile layout" }),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator(".layout--routed")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".layout--demo-peer-split")).toBeVisible();
}

for (const variant of ["app", "demo"]) {
  test(`production ${variant} starts and reloads offline`, async ({
    context,
    page,
  }) => {
    test.setTimeout(90_000);
    // Serve the exact deployment output without Bun's development bundler,
    // which selects a different Loro entrypoint and masks missing WASM assets.
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const filename = pathname === "/" ? "index.html" : `.${pathname}`;
      void readFile(join(appDir, "dist", filename)).then(
        (bytes) => {
          response.writeHead(200, {
            "Content-Type":
              contentTypes[extname(filename)] ?? "application/octet-stream",
          });
          response.end(bytes);
        },
        () => {
          response.writeHead(404);
          response.end();
        },
      );
    });

    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Static production server has no TCP address.");
      }
      const origin = `http://127.0.0.1:${address.port}`;
      // pree2e already builds the SDK. Avoid prebuild clearing its dist while
      // the other browser tests are using the development server.
      await promisify(execFile)("sh", ["-c", packageJson.scripts.build], {
        cwd: appDir,
        env: {
          ...process.env,
          BUN_PUBLIC_APP_VARIANT: variant,
          BUN_PUBLIC_SENTRY_DSN: SENTRY_TEST_DSN,
          BUN_PUBLIC_SENTRY_ENVIRONMENT: "staging",
          BUN_PUBLIC_SENTRY_COMMIT: SENTRY_TEST_COMMIT,
          SENTRY_AUTH_TOKEN: SENTRY_UPLOAD_TOKEN_SENTINEL,
          BUN_PUBLIC_API_BASE_URL: `${origin}/api`,
          BUN_PUBLIC_WS_URL: `${origin.replace("http:", "ws:")}/events`,
        },
      });

      const pageErrors: string[] = [];
      const loroRequests: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("loro_wasm_bg.wasm")) {
          loroRequests.push(request.url());
        }
      });

      const assertSentry = await observeProductionSentry(page);
      await page.goto(origin);
      if (variant === "demo") {
        await assertDemoLayout(page);
      }
      const menu = page
        .getByRole("button", { name: "Menu", exact: true })
        .first();
      await expect(menu).toBeVisible();
      await expect(page.locator('script[type="module"]')).toHaveAttribute(
        "src",
        /^\/[^/]+\.js$/,
      );
      await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
      );
      if (variant === "app") await assertSentry();

      await context.setOffline(true);
      await page.reload();
      await expect(menu).toBeVisible();
      if (variant === "app") {
        const { preview } = await uploadAndOpenPdf(
          page,
          "offline-cjk.pdf",
          cjkPdf(),
          false,
        );
        await expect(preview.locator(".pdfViewer canvas")).toBeVisible();
        await expect(preview.locator(".textLayer")).toContainText("日");
      }
      expect(pageErrors).toEqual([]);
      expect(loroRequests).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  });
}
