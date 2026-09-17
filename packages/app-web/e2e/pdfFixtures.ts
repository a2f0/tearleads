import { expect, type Page } from "@playwright/test";

function encodePdf(objects: string[]): Buffer {
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

export function twoPagePdf(): Buffer {
  const content = (label: string) => `BT /F1 24 Tf 40 300 Td (${label}) Tj ET`;
  const first = content("Page One");
  const second = content("Page Two");
  return encodePdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
    `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
  ]);
}

export function cjkPdf(): Buffer {
  const content = "BT /F1 24 Tf 40 300 Td <65E5> Tj ET";
  return encodePdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [5 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 6 0 R /DW 1000 >>",
    "<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

// One blank page, encrypted with the user password "secret" (PDF Standard V2).
export function passwordProtectedPdf(): Buffer {
  return Buffer.from(
    [
      "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGQwNGQ3NmNjOWE+Cj4+CmVuZG9iagoyIDAgb2JqCjw8",
      "Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0Nh",
      "dGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4K",
      "L01lZGlhQm94IFsgMC4wIDAuMCAzMDAgNDAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAy",
      "Ci9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8MGU1MjI5MjVhM2U0ZTg3",
      "NGMzY2ZhY2JlZjUxMWE3M2FjNGVjMmJkODY1ZGNkM2Q0NjI3NjE0OTE3YWJmZDdlND4KL1UgPDUwMzlhOTM3NTUwZTM1",
      "YjQ1OGZhNzAxM2M5NTViMjVjMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAg",
      "NgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAw",
      "MTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXpl",
      "IDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDM2MzczMjY0MzYzODM0MzczMTM4NjM2MjMwMzE2NDMzMzgz",
      "NTYyNjUzNjMyNjYzMTMwNjIzMjMwMzY2NjM3Mzk+IDwzNjM3MzI2NDM2MzgzNDM3MzEzODYzNjIzMDMxNjQzMzM4MzU2",
      "MjY1MzYzMjY2MzEzMDYyMzIzMDM2NjYzNzM5PiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK",
    ].join(""),
    "base64",
  );
}

export async function uploadAndOpenPdf(
  page: Page,
  fileName: string,
  buffer: Buffer,
  navigate = true,
) {
  if (navigate) await page.goto("/");
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
    buffer,
    mimeType: "application/pdf",
    name: fileName,
  });
  const row = window
    .locator(".explorer-item-row-button", { hasText: fileName })
    .first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  const preview = window.getByRole("region", { name: fileName });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  return { preview, window };
}
