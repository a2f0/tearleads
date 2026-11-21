import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { controlPixels } from "./controlPixels";
import { measureAttached } from "./domMeasure";
import { themeForeground } from "./themeForeground";

/*
 * Explorer History on a phone: a timeline (transport buttons, a slider over
 * every change, the time and summary of the selected change) above the
 * document as it was at that change.
 *
 * The layout claims are measured from what the browser draws. Buttons that
 * shrink below a touch target, a slider squeezed to nothing, and a timeline
 * that overlaps the document it controls all look correct in the markup.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

/** Apple HIG minimum hit target, which the routed shell's controls honor. */
const TOUCH_TARGET = 44;
const STREET = "17 Maple Street";

function addresses(page: Page): Locator {
  return page.getByRole("region", { name: "Addresses", exact: true });
}

async function createContactWithAddress(page: Page, name: string) {
  await page.goto("/app/contacts/new");
  await page.getByLabel("Nickname", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/contacts\/contact\/[^/]+$/u);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await expect(addresses(page)).toHaveCount(0);
  // History keeps one step per second of edits: let the creation's second
  // pass so the address is a step of its own.
  await page.waitForTimeout(2100);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await addresses(page).getByRole("button", { name: "Add address" }).click();
  const form = page.getByRole("form", { name: "Address editor" });
  await form.getByLabel("Label", { exact: true }).fill("Home");
  await form.getByLabel("Street address", { exact: true }).fill(STREET);
  await page.getByRole("button", { name: "Save address", exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(addresses(page).getByText(STREET)).toBeVisible();
}

async function openExplorerContact(page: Page, name: string) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Apps" })
    .getByRole("link", { name: "Explorer", exact: true })
    .click();
  await page
    .locator(".explorer-item-row-button")
    .filter({ hasText: "Contacts" })
    .click();
  await page
    .locator(".explorer-item-row-button")
    .filter({ hasText: name })
    .click();
  await expect(page).toHaveURL(
    /\/app\/explorer\/containers\/[^/]+\/documents\/[^/]+$/u,
  );
}

function slider(page: Page): Locator {
  return page.getByRole("slider", { name: "History position" });
}

/** Wait for the selected step to finish replaying. */
async function expectSettled(page: Page) {
  await expect(page.locator(".explorer-document-history-view")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

interface TimelineGeometry {
  /** Transport buttons and the slider, by accessible name. */
  controls: Array<{
    height: number;
    left: number;
    name: string;
    right: number;
    width: number;
  }>;
  /** How far the timeline's content reaches past its own box, in px. */
  overhang: number;
  timelineBottom: number;
  viewTop: number;
  viewportWidth: number;
}

async function measureTimeline(page: Page): Promise<TimelineGeometry> {
  const timeline = page.locator(".explorer-document-history-timeline");
  await expect(timeline).toBeVisible();
  return measureAttached("history timeline", () =>
    timeline.evaluate((element) => {
      const view = document.querySelector(".explorer-document-history-view");
      if (!element.isConnected || !view?.isConnected) return null;
      const controls = Array.from(
        element.querySelectorAll(
          ".explorer-document-history-transport button, .explorer-document-history-transport input",
        ),
      ).map((control) => {
        const box = control.getBoundingClientRect();
        return {
          height: box.height,
          left: box.left,
          name: control.getAttribute("aria-label") ?? "",
          right: box.right,
          width: box.width,
        };
      });
      return {
        controls,
        overhang: element.scrollWidth - element.clientWidth,
        timelineBottom: element.getBoundingClientRect().bottom,
        viewTop: view.getBoundingClientRect().top,
        viewportWidth: document.documentElement.clientWidth,
      };
    }),
  );
}

test("History fits a phone: touch-sized controls above the document, nothing overflowing", async ({
  page,
}) => {
  const name = `History Layout ${Date.now()}`;
  await createContactWithAddress(page, name);
  await openExplorerContact(page, name);

  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[^/]+\/history$/u);
  await expect(slider(page)).toBeVisible();
  await expectSettled(page);

  const geometry = await measureTimeline(page);
  expect(geometry.controls.map((control) => control.name)).toEqual([
    "First version",
    "Previous change",
    "Play",
    "Next change",
    "Latest version",
    "History position",
  ]);
  for (const control of geometry.controls) {
    expect(control.height, control.name).toBeGreaterThanOrEqual(TOUCH_TARGET);
    expect(control.width, control.name).toBeGreaterThanOrEqual(TOUCH_TARGET);
    expect(control.left, control.name).toBeGreaterThanOrEqual(0);
    expect(control.right, control.name).toBeLessThanOrEqual(
      geometry.viewportWidth,
    );
  }
  expect(geometry.overhang).toBeLessThanOrEqual(0);
  // The timeline sits above the document it controls; they never overlap.
  expect(geometry.viewTop).toBeGreaterThanOrEqual(geometry.timelineBottom);

  const pixels = await controlPixels(slider(page));
  expect(pixels.row.at(-8)).toBe(await themeForeground(slider(page)));
  // Tap above the painted track, within the full-height touch target.
  await slider(page).tap({ position: { x: 2, y: 4 } });
  await expect(slider(page)).toHaveValue("0");
  await expectSettled(page);
  await expect(page.locator(".contact-document-fields")).toBeVisible();
  await expect(addresses(page)).toHaveCount(0);
  const box = await slider(page).boundingBox();
  if (!box) throw new Error("Expected a visible History slider");
  const touch = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  try {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + 8, y }],
    });
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: box.x + 8 + (box.width - 16) * fraction, y }],
      });
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await touch.detach();
  }
  await expectSettled(page);
  await expect(addresses(page).getByText(STREET)).toBeVisible();
});

test("History steps back to an earlier version and restores it", async ({
  page,
}) => {
  const name = `History Restore ${Date.now()}`;
  await createContactWithAddress(page, name);
  await openExplorerContact(page, name);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(slider(page)).toBeVisible();
  await expectSettled(page);
  const historyUrl = page.url();

  // The newest step is the document as it is.
  await expect(addresses(page).getByText(STREET)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore this version" }),
  ).toHaveCount(0);
  // A past version is read-only.
  await expect(page.getByRole("button", { name: "Add address" })).toHaveCount(
    0,
  );

  const lastStop = Number(await slider(page).getAttribute("max"));
  expect(lastStop).toBeGreaterThanOrEqual(1);
  // Step back until the address is gone.
  for (let steps = 0; steps < lastStop; steps += 1) {
    if ((await addresses(page).getByText(STREET).count()) === 0) break;
    await page.getByRole("button", { name: "Previous change" }).click();
    await expectSettled(page);
  }
  await expect(page.locator(".contact-document-fields")).toBeVisible();
  await expect(addresses(page)).toHaveCount(0);

  // A restore within a second of the edit before it would share that edit's
  // step; a person never restores that fast, but this test does.
  await page.waitForTimeout(2100);
  await page.getByRole("button", { name: "Restore this version" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore this version?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // The restore is a new step, and History reopens on it.
  await expect
    .poll(async () => Number(await slider(page).getAttribute("max")))
    .toBeGreaterThan(lastStop);
  await expectSettled(page);
  await expect(page.locator(".contact-document-fields")).toBeVisible();
  await expect(addresses(page)).toHaveCount(0);

  // The live document holds the restored version, and it survives a reload.
  await page.reload();
  await expect(page).toHaveURL(historyUrl);
  await expect(slider(page)).toBeVisible();
  await expectSettled(page);
  await expect(page.locator(".contact-document-fields")).toBeVisible();
  await expect(addresses(page)).toHaveCount(0);
});

test("History saves an earlier version as a separate document", async ({
  page,
}) => {
  const name = `History Copy ${Date.now()}`;
  await createContactWithAddress(page, name);
  await openExplorerContact(page, name);
  const documentUrl = page.url();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(slider(page)).toBeVisible();
  await expectSettled(page);

  const lastStop = Number(await slider(page).getAttribute("max"));
  expect(lastStop).toBeGreaterThanOrEqual(1);
  // Step back until the address is gone.
  for (let steps = 0; steps < lastStop; steps += 1) {
    if ((await addresses(page).getByText(STREET).count()) === 0) break;
    await page.getByRole("button", { name: "Previous change" }).click();
    await expectSettled(page);
  }
  await expect(page.locator(".contact-document-fields")).toBeVisible();
  await expect(addresses(page)).toHaveCount(0);

  // Restore and Save as copy share a row that fits the phone.
  const actions = page.locator(".explorer-document-history-actions button");
  await expect(actions).toHaveText(["Restore this version", "Save as copy"]);
  const viewportWidth = page.viewportSize()?.width ?? 0;
  for (const action of await actions.all()) {
    const box = await action.boundingBox();
    if (!box) throw new Error("Expected a visible History action");
    expect(box.height).toBeGreaterThanOrEqual(TOUCH_TARGET);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
  }

  await page.getByRole("button", { name: "Save as copy" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Save this version as a copy?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save copy", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Saved a copy in this folder.")).toBeVisible();
  // Nothing was written to the document being viewed.
  expect(Number(await slider(page).getAttribute("max"))).toBe(lastStop);

  // The copy is another document, holding the version it was saved from.
  await page.getByRole("button", { name: "Open copy", exact: true }).click();
  await expect(page).toHaveURL(
    /\/app\/explorer\/containers\/[^/]+\/documents\/[^/]+$/u,
  );
  expect(page.url()).not.toBe(documentUrl);
  await expect(page.locator(".contact-document-fields")).toBeVisible();
  await expect(addresses(page)).toHaveCount(0);

  // Both survive a reload: the copy without the address, the original with.
  await page.reload();
  await expect(page.locator(".contact-document-fields")).toBeVisible();
  await expect(addresses(page)).toHaveCount(0);
  await page.goto(documentUrl);
  await expect(addresses(page).getByText(STREET)).toBeVisible();
});
