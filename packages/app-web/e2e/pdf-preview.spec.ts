import { expect, test } from "@playwright/test";

function twoPagePdf(): Buffer {
  const content = (label: string) => `BT /F1 24 Tf 40 300 Td (${label}) Tj ET`;
  const first = content("Page One");
  const second = content("Page Two");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
    `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("PDF pages render inline without an open action", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.locator(".pane-footer-menu-button").first().click();
  await page
    .locator(".menu")
    .getByRole("button", { name: "Explorer", exact: true })
    .click();
  const window = page.locator(".window").first();
  await expect(window).toBeVisible({ timeout: 30_000 });
  await window.locator(".window-maximize").click();

  const chooser = page.waitForEvent("filechooser");
  await window.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles({
    buffer: twoPagePdf(),
    mimeType: "application/pdf",
    name: "inline-preview.pdf",
  });
  const row = window
    .locator(".explorer-item-row-button", { hasText: "inline-preview.pdf" })
    .first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  const preview = window.getByRole("region", { name: "inline-preview.pdf" });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview.locator(".pdfViewer .page")).toHaveCount(2);
  await expect(preview.locator(".pdfViewer canvas").first()).toBeVisible();
  await expect(preview.locator(".textLayer").first()).toContainText("Page One");
  await expect(preview.getByText("1 / 2")).toBeVisible();
  await expect(window.getByRole("button", { name: "View PDF" })).toHaveCount(0);
});
