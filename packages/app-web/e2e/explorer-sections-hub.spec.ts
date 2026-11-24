import { expect, type Page, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";

const ATTACHMENT_NAME = "a-rather-long-attachment-filename.svg";

/** A note with one attachment, so the Blob Browser has a blob with links. */
async function createNoteWithAttachment(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/notes");
  await createFirstIdentity(page);
  await page.getByRole("button", { name: "No notes. Create one" }).click();
  const editor = page.getByRole("textbox", { name: "Notes editor" });
  await expect(editor).toBeEditable();
  await editor.fill("Quarterly planning notes with a long title");
  await page.locator(".note-document-file-input").setInputFiles({
    name: ATTACHMENT_NAME,
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="60"><rect width="90" height="60"/></svg>',
    ),
  });
  await expect(
    page.getByRole("button", { name: `Open ${ATTACHMENT_NAME}` }),
  ).toBeVisible();
}

test("each Explorer sections tab opens on its content, clear of the tab strip", async ({
  page,
}) => {
  await createNoteWithAttachment(page);

  for (const [segment, tabName] of [
    ["sync", "Sync Lanes"],
    ["blobs", "Blob Browser"],
    ["outgoing", "Outgoing"],
    ["incoming", "Incoming"],
  ] as const) {
    await page.goto(`/app/explorer/${segment}`);
    const panel = page.getByRole("tabpanel", { name: tabName });
    await expect(panel).toBeVisible();
    // The tab names the view; no panel header repeats it.
    await expect(panel.locator(".mini-app-header")).toHaveCount(0);

    const tabs = page.getByRole("tablist", { name: "Explorer sections" });
    const first = panel.locator(".explorer-detail > *").first();
    await expect(first).toBeVisible();
    const tabsBox = await tabs.boundingBox();
    const firstBox = await first.boundingBox();
    if (!tabsBox || !firstBox) throw new Error(`Missing ${tabName} geometry`);
    // The panel keeps the header's breathing room: its first row starts a
    // full spacing step below the strip rather than against it.
    expect(firstBox.y - (tabsBox.y + tabsBox.height)).toBeGreaterThanOrEqual(
      12,
    );
  }
});

test("blob document links fold into the Explorer's two-line row on phones", async ({
  page,
}) => {
  await createNoteWithAttachment(page);
  await page.goto("/app/explorer/blobs");
  await page
    .getByRole("table", { name: "Blob Browser" })
    .locator("tbody tr")
    .first()
    .getByRole("button")
    .first()
    .click();

  const links = page.getByRole("table", { name: "Document Links" });
  const row = links.locator("tbody tr").first();
  await row.scrollIntoViewIfNeeded();
  await expect(row.locator(".mini-app-compact-table-visual svg")).toBeVisible();
  await expect(row.locator(".mini-app-compact-table-line")).toHaveCount(2);
  // The details line leads with the link's state, which tells a document's
  // local and pending links apart.
  await expect(
    row.locator(".mini-app-compact-table-line--muted"),
  ).toContainText(/^.*: (local|pending) · /u);

  const geometry = await row.evaluate((element) => {
    const title = element.querySelector(".mini-app-compact-table-line");
    const button = element.querySelector(".explorer-blob-reference-row-button");
    if (!title || !button) throw new Error("Missing document link title");
    return {
      button: button.getBoundingClientRect().height,
      height: element.getBoundingClientRect().height,
      pitch: Number.parseFloat(
        getComputedStyle(element).getPropertyValue(
          "--mini-app-virtual-row-height",
        ),
      ),
      title: title.getBoundingClientRect().height,
    };
  });
  // The title sits on its text line, as the item list's does, so the row
  // holds the shared two-line pitch instead of a 44px title line plus details.
  expect(geometry.button).toBeLessThan(30);
  expect(geometry.title).toBeLessThan(30);
  expect(geometry.height).toBeCloseTo(geometry.pitch, 0);
});
