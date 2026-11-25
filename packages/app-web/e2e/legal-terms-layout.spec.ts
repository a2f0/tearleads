import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { legalTermsAgreement } from "./legalTermsAgreement";

/*
 * The legal terms a new identity agrees to, laid out by the shape of the pane
 * that shows them. A phone or an upright tablet stacks the documents between
 * the copy and the agreement; a landscape pane sets the copy and the agreement
 * beside documents that run its full height.
 *
 * Measured from what the browser draws: the tab strip used to bleed past the
 * documents' frame on both sides, and the documents sat in a 26rem column a
 * desktop surrounded with empty space, though the markup looked the same.
 *
 * Imports the plain Playwright test, not appTest, whose prompt handlers would
 * agree to the terms before the spec could measure them.
 */

const BORDER_ALLOWANCE = 2;

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected a rendered box.");
  }
  return {
    bottom: box.y + box.height,
    height: box.height,
    left: box.x,
    right: box.x + box.width,
    top: box.y,
    width: box.width,
  };
}

async function openAgreement(page: Page) {
  await page.goto("/app/identity-manager/recovery-key");
  await page
    .getByRole("button", { name: "Create new identity", exact: true })
    .first()
    .click();
  const checkbox = legalTermsAgreement(page);
  await expect(checkbox).toBeVisible();
  const frame = page.locator(".legal-terms-agreement-documents");
  return {
    checkbox,
    continueButton: page.getByRole("button", { name: "Continue" }),
    frame,
    label: page.locator(".legal-terms-agreement-check > span"),
    strip: frame.getByRole("tablist", { name: "Legal documents" }),
    tabs: frame.getByRole("tab"),
    text: frame.getByRole("tabpanel"),
    title: page.getByRole("heading", { name: "Review our terms" }),
  };
}

type Agreement = Awaited<ReturnType<typeof openAgreement>>;

/** The strip spans the frame's inside, and every tab shows within it. */
async function expectStripInsideFrame(agreement: Agreement) {
  const frame = await boxOf(agreement.frame);
  const strip = await boxOf(agreement.strip);
  expect(strip.left - frame.left).toBeGreaterThanOrEqual(0);
  expect(strip.left - frame.left).toBeLessThanOrEqual(BORDER_ALLOWANCE);
  expect(frame.right - strip.right).toBeGreaterThanOrEqual(0);
  expect(frame.right - strip.right).toBeLessThanOrEqual(BORDER_ALLOWANCE);
  for (const tab of await agreement.tabs.all()) {
    const drawn = await boxOf(tab);
    expect(drawn.left).toBeGreaterThanOrEqual(strip.left);
    expect(drawn.right).toBeLessThanOrEqual(strip.right);
  }
}

/** The documents scroll inside their frame rather than growing the page. */
async function expectTextScrollsInFrame(agreement: Agreement) {
  const overflow = await agreement.text.evaluate(
    (node) => node.scrollHeight - node.clientHeight,
  );
  expect(overflow).toBeGreaterThan(0);
}

/** The label stands apart from its box. */
async function expectLabelClearOfCheckbox(agreement: Agreement) {
  const checkbox = await boxOf(agreement.checkbox);
  const label = await boxOf(agreement.label);
  expect(label.left - checkbox.right).toBeGreaterThanOrEqual(8);
}

async function expectStacked(agreement: Agreement) {
  const frame = await boxOf(agreement.frame);
  const title = await boxOf(agreement.title);
  const checkbox = await boxOf(agreement.checkbox);
  expect(frame.top).toBeGreaterThan(title.bottom);
  // Space between the scrolling text and the agreement under it.
  expect(checkbox.top - frame.bottom).toBeGreaterThanOrEqual(16);
}

async function expectSideBySide(agreement: Agreement) {
  const frame = await boxOf(agreement.frame);
  const title = await boxOf(agreement.title);
  const continueButton = await boxOf(agreement.continueButton);
  expect(title.right).toBeLessThanOrEqual(frame.left);
  expect(continueButton.right).toBeLessThanOrEqual(frame.left);
  // The documents run the column's full height, at least as far as the copy
  // both ways (on a short screen the copy can fill the column).
  expect(frame.top).toBeLessThanOrEqual(title.top);
  expect(frame.bottom).toBeGreaterThanOrEqual(continueButton.bottom);
}

/**
 * The whole panel fits its pane, so nothing but the documents scrolls, from
 * the moment it appears: the shared state panel's entrance rise overflowed it.
 */
async function expectPanelFitsPane(page: Page) {
  const overflow = await page
    .locator(".legal-terms-agreement")
    .evaluate((node) => node.scrollHeight - node.clientHeight);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("phone", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("stacks the documents above the agreement", async ({ page }) => {
    const agreement = await openAgreement(page);
    await expectStacked(agreement);
    await expectStripInsideFrame(agreement);
    await expectTextScrollsInFrame(agreement);
    await expectLabelClearOfCheckbox(agreement);
    await expect(agreement.continueButton).toBeInViewport();
  });
});

test.describe("upright tablet", () => {
  test.use({ viewport: { height: 1180, width: 820 } });

  test("widens the stacked documents to a reading column", async ({ page }) => {
    const agreement = await openAgreement(page);
    await expectStacked(agreement);
    await expectStripInsideFrame(agreement);
    // Wider than the 26rem column a tablet showed before.
    expect((await boxOf(agreement.frame)).width).toBeGreaterThan(600);
    await expect(agreement.continueButton).toBeInViewport();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { height: 800, width: 1280 } });

  test("sets the agreement beside the documents", async ({ page }) => {
    const agreement = await openAgreement(page);
    await expectSideBySide(agreement);
    await expectStripInsideFrame(agreement);
    await expectTextScrollsInFrame(agreement);
    await expectLabelClearOfCheckbox(agreement);
    await expect(agreement.continueButton).toBeInViewport();
  });
});

test.describe("phone on its side", () => {
  test.use({ viewport: { height: 375, width: 667 } });

  // Identity Manager's own minimum height lets its pane scroll on a screen
  // this short, so the panel is held to fitting that pane, not the screen.
  test("sets the agreement beside the documents", async ({ page }) => {
    const agreement = await openAgreement(page);
    await expectSideBySide(agreement);
    await expectStripInsideFrame(agreement);
    await expectTextScrollsInFrame(agreement);
    await expectPanelFitsPane(page);
  });
});
