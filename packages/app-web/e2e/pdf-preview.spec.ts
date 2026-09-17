import { expect, test } from "@playwright/test";
import { cjkPdf, twoPagePdf, uploadAndOpenPdf } from "./pdfFixtures";

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
