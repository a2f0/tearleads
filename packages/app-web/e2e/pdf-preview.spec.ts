import { expect, test } from "@playwright/test";
import {
  cjkPdf,
  fillablePdf,
  passwordProtectedPdf,
  twoPagePdf,
  uploadAndOpenPdf,
} from "./pdfFixtures";

test("PDF pages render inline without an open action", async ({ page }) => {
  test.setTimeout(90_000);
  const { preview, window } = await uploadAndOpenPdf(
    page,
    "inline-preview.pdf",
    twoPagePdf(),
  );
  await expect(preview.locator(".pdfViewer .page")).toHaveCount(2);
  await expect(preview.locator(".pdfViewer canvas").first()).toBeVisible();
  await expect(preview.locator(".textLayer").first()).toContainText("Page One");
  await expect(preview.getByText("1 / 2")).toBeVisible();
  await expect(window.getByRole("button", { name: "View PDF" })).toHaveCount(0);
});

test("predefined CJK maps and decoder assets are served to the viewer", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const cmapRequest = page.waitForRequest((request) =>
    request.url().includes("/pdfjs/cmaps/UniJIS-UCS2-H.bcmap"),
  );
  const { preview } = await uploadAndOpenPdf(page, "cjk-preview.pdf", cjkPdf());
  await cmapRequest;
  await expect(preview.locator(".pdfViewer canvas")).toBeVisible();
  await expect(preview.locator(".textLayer")).toContainText("日");

  for (const asset of [
    "wasm/openjpeg.wasm",
    "wasm/jbig2.wasm",
    "standard_fonts/FoxitSerif.pfb",
  ]) {
    const response = await page.request.get(`/pdfjs/${asset}`);
    expect(response.ok()).toBe(true);
    expect((await response.body()).byteLength).toBeGreaterThan(0);
  }
});

test("fillable PDF fields are previewed without editable controls", async ({
  page,
}) => {
  const pdf = fillablePdf();
  expect(pdf.toString()).toContain("/AcroForm");
  const { preview } = await uploadAndOpenPdf(page, "form.pdf", pdf);
  await expect(preview.locator(".pdfViewer canvas")).toBeVisible();
  await expect(preview.locator(".annotationLayer input")).toHaveCount(0);
});

test("password-protected PDFs support retry and unlock", async ({ page }) => {
  const { preview } = await uploadAndOpenPdf(
    page,
    "encrypted.pdf",
    passwordProtectedPdf(),
  );
  await expect(
    preview.getByText("This PDF requires a password."),
  ).toBeVisible();
  await preview.getByLabel("PDF password").fill("wrong");
  await preview.getByRole("button", { name: "Unlock" }).click();
  await expect(
    preview.getByText("Incorrect PDF password. Try again."),
  ).toBeVisible();
  await preview.getByLabel("PDF password").fill("secret");
  await preview.getByRole("button", { name: "Unlock" }).click();
  await expect(preview.getByText("1 / 1")).toBeVisible();
  await expect(preview.locator(".pdfViewer canvas")).toBeVisible();
});

test("password prompt can be cancelled", async ({ page }) => {
  const { preview } = await uploadAndOpenPdf(
    page,
    "cancel-encrypted.pdf",
    passwordProtectedPdf(),
  );
  await expect(
    preview.getByText("This PDF requires a password."),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Cancel" }).click();
  await expect(preview.getByText("PDF preview cancelled.")).toBeVisible();
  await expect(preview.getByText("PDF preview unavailable")).toBeVisible();
  await expect(preview.getByText("Loading PDF...")).toHaveCount(0);
});

test("closing while awaiting a password releases the PDF worker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    let terminated = 0;
    Object.defineProperty(globalThis, "__pdfWorkersTerminated", {
      get: () => terminated,
    });
    globalThis.Worker = class extends NativeWorker {
      private readonly pdfWorker: boolean;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.pdfWorker = String(url).includes("/pdf.worker.js");
      }

      override terminate() {
        if (this.pdfWorker) terminated += 1;
        super.terminate();
      }
    };
  });
  const { preview, window } = await uploadAndOpenPdf(
    page,
    "close-encrypted.pdf",
    passwordProtectedPdf(),
  );
  await expect(
    preview.getByText("This PDF requires a password."),
  ).toBeVisible();
  await window.locator(".window-close").click();
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __pdfWorkersTerminated?: number })
        .__pdfWorkersTerminated === 1,
  );
});

test("closing and reopening PDFs releases their workers", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    let created = 0;
    let terminated = 0;
    Object.defineProperty(globalThis, "__pdfWorkersCreated", {
      get: () => created,
    });
    Object.defineProperty(globalThis, "__pdfWorkersTerminated", {
      get: () => terminated,
    });
    globalThis.Worker = class extends NativeWorker {
      private readonly pdfWorker: boolean;

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.pdfWorker = String(url).includes("/pdf.worker.js");
        if (this.pdfWorker) created += 1;
      }

      override terminate() {
        if (this.pdfWorker) terminated += 1;
        super.terminate();
      }
    };
  });

  const { preview, window } = await uploadAndOpenPdf(
    page,
    "reopen.pdf",
    twoPagePdf(),
  );
  await expect(preview.locator(".pdfViewer canvas").first()).toBeVisible();
  await window.locator(".window-close").click();
  await page.waitForFunction(() => {
    const state = globalThis as typeof globalThis & {
      __pdfWorkersCreated?: number;
      __pdfWorkersTerminated?: number;
    };
    return (
      state.__pdfWorkersCreated === state.__pdfWorkersTerminated &&
      (state.__pdfWorkersCreated ?? 0) > 0
    );
  });
  const firstWorkerCount = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __pdfWorkersCreated?: number })
        .__pdfWorkersCreated ?? 0,
  );

  await page.locator(".pane-footer-menu-button").first().click();
  await page
    .locator(".menu")
    .getByRole("button", { name: "Explorer", exact: true })
    .click();
  const reopenedWindow = page.locator(".window").first();
  await reopenedWindow
    .locator(".explorer-item-row-button", { hasText: "reopen.pdf" })
    .first()
    .click();
  await expect(
    reopenedWindow.locator(".pdfViewer canvas").first(),
  ).toBeVisible();
  await reopenedWindow.locator(".window-close").click();
  await page.waitForFunction((previousCount) => {
    const state = globalThis as typeof globalThis & {
      __pdfWorkersCreated?: number;
      __pdfWorkersTerminated?: number;
    };
    return (
      state.__pdfWorkersCreated === state.__pdfWorkersTerminated &&
      (state.__pdfWorkersCreated ?? 0) > previousCount
    );
  }, firstWorkerCount);
});
