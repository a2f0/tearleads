import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { BACKUP_AGREEMENT_LABEL } from "./createFirstIdentity";
import { agreeToLegalTerms } from "./legalTermsAgreement";

/*
 * The prompt a new identity backs up its recovery key in, laid out by the
 * width of the pane that shows it. A phone held upright stacks the copy, the
 * backup menu, what it reveals, and the agreement; anything wider sets the
 * copy, the menu, and the agreement beside a frame that holds the revealed
 * passphrase and QR code.
 *
 * Measured from what the browser draws: stacked, revealing the key pushed the
 * agreement and the Continue button below a tablet's or a desktop's screen.
 */

const ACKNOWLEDGEMENT = /Type i understand to continue/u;

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

/** The prompt's parts, found inside its own box within `scope`. */
async function findPrompt(page: Page, scope: Locator | Page = page) {
  const panel = scope.locator(".recovery-key-backup-confirmation").first();
  const agreement = panel.getByLabel(BACKUP_AGREEMENT_LABEL);
  await expect(agreement).toBeVisible({ timeout: 30_000 });
  // Measure the settled layout: a late web font would rewrap the copy.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const menu = panel.getByRole("list", { name: "Recovery key actions" });
  return {
    agreement,
    continueButton: panel.getByRole("button", { name: "Continue" }),
    firstRow: menu.getByRole("button").first(),
    frame: panel.locator(".recovery-key-revealed"),
    menu,
    panel,
    passphrase: panel.getByRole("textbox", { name: "Passphrase", exact: true }),
    placeholder: panel.getByText(
      "Choose View or QR Code to show your recovery key here.",
    ),
    qr: panel.getByAltText("Recovery key QR code"),
    status: panel.getByText("Recovery QR code revealed."),
    title: panel.getByRole("heading", { name: "Back up your recovery key" }),
  };
}

type Prompt = Awaited<ReturnType<typeof findPrompt>>;

/** Creates a new identity in `scope` up to its backup prompt. */
async function createIdentityToPrompt(page: Page, scope: Locator | Page) {
  await scope
    .getByRole("button", { name: "Create new identity", exact: true })
    .first()
    .click();
  await agreeToLegalTerms(
    scope
      .getByRole("checkbox", {
        name: "I agree to the Terms of Service and Privacy Policy",
      })
      .first(),
  );
  const name = scope
    .getByRole("textbox", { name: "What should we call you?" })
    .first();
  await name.fill("Bob");
  await name.press("Enter");
  return findPrompt(page, scope);
}

/** A new identity's backup prompt, in Identity Manager. */
async function openPrompt(page: Page): Promise<Prompt> {
  await page.goto("/app/identity-manager/recovery-key");
  return createIdentityToPrompt(page, page);
}

/** Acknowledges a disclosure the menu asked for, in its dialog. */
async function acknowledge(page: Page, confirmLabel: string) {
  await page.getByLabel(ACKNOWLEDGEMENT).fill("i understand");
  await page.getByRole("button", { name: confirmLabel }).click();
}

/** Shows the passphrase and its QR code, as a person backing it up would. */
async function revealKey(page: Page, prompt: Prompt) {
  await prompt.panel.getByRole("button", { name: "View Recovery Key" }).click();
  await acknowledge(page, "Show Passphrase");
  await prompt.panel
    .getByRole("button", { name: "QR Code for Recovery Key" })
    .click();
  await acknowledge(page, "Show QR Code");
  await expect(prompt.passphrase).toBeVisible();
  await expect(prompt.qr).toBeVisible();
}

/** How far a box's content reaches past its scrollport, in px. */
function overflowOf(locator: Locator): Promise<number> {
  return locator.evaluate((node) => node.scrollHeight - node.clientHeight);
}

/** `inner` lies within `outer`'s box, borders allowed for. */
async function expectWithin(inner: Locator, outer: Locator) {
  const drawn = await boxOf(inner);
  const frame = await boxOf(outer);
  expect(drawn.left).toBeGreaterThanOrEqual(frame.left);
  expect(drawn.right).toBeLessThanOrEqual(frame.right);
  expect(drawn.top).toBeGreaterThanOrEqual(frame.top);
}

/** The copy, the menu, and the agreement sit left of the revealed key's
 *  frame, which runs at least the column's height. */
async function expectSideBySide(prompt: Prompt) {
  const frame = await boxOf(prompt.frame);
  const title = await boxOf(prompt.title);
  const menu = await boxOf(prompt.menu);
  const continueButton = await boxOf(prompt.continueButton);
  expect(title.right).toBeLessThanOrEqual(frame.left);
  expect(menu.right).toBeLessThanOrEqual(frame.left);
  expect(continueButton.right).toBeLessThanOrEqual(frame.left);
  expect(menu.top).toBeGreaterThan(title.bottom);
  expect(continueButton.top).toBeGreaterThan(menu.bottom);
  expect(frame.top).toBeLessThanOrEqual(title.top);
  expect(frame.bottom).toBeGreaterThanOrEqual(continueButton.bottom);
}

/** Where the menu's first row and the agreement sit, from the frame's top,
 *  so a prompt that scrolls as a whole measures the same scrolled or not. */
async function columnOffsets(prompt: Prompt) {
  const frame = await boxOf(prompt.frame);
  return {
    agreement: (await boxOf(prompt.agreement)).top - frame.top,
    frameHeight: frame.height,
    row: (await boxOf(prompt.firstRow)).top - frame.top,
  };
}

/**
 * Before anything is revealed the frame says what it is for. Revealed, the
 * passphrase, its QR code, and the status saying so fill the frame, which
 * keeps its size and scrolls what does not fit. The agreement stays where it
 * was, and so does the row just chosen, which stays under the pointer.
 */
async function expectRevealFillsFrame(page: Page, prompt: Prompt) {
  await expect(prompt.placeholder).toBeVisible();
  await expectWithin(prompt.placeholder, prompt.frame);
  const before = await columnOffsets(prompt);

  await revealKey(page, prompt);

  await expect(prompt.placeholder).toBeHidden();
  await expectWithin(prompt.status, prompt.frame);
  await expectWithin(prompt.passphrase, prompt.frame);
  await expectWithin(prompt.qr, prompt.frame);
  // The whole passphrase shows, not its first few lines.
  expect(await overflowOf(prompt.passphrase)).toBeLessThanOrEqual(0);
  const after = await columnOffsets(prompt);
  expect(after.frameHeight).toBeCloseTo(before.frameHeight, 0);
  expect(after.row).toBeCloseTo(before.row, 0);
  expect(after.agreement).toBeCloseTo(before.agreement, 0);
  await expectSideBySide(prompt);
}

test.describe("phone", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("stacks the revealed key between the menu and the agreement", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const prompt = await openPrompt(page);
    // Stacked, the revealed key needs no frame, so nothing stands in for it.
    await expect(prompt.placeholder).toBeHidden();
    const title = await boxOf(prompt.title);
    expect((await boxOf(prompt.menu)).top).toBeGreaterThan(title.bottom);

    await revealKey(page, prompt);
    const menu = await boxOf(prompt.menu);
    const passphrase = await boxOf(prompt.passphrase);
    const qr = await boxOf(prompt.qr);
    expect(passphrase.top).toBeGreaterThan(menu.bottom);
    expect(qr.top).toBeGreaterThan(passphrase.bottom);
    expect((await boxOf(prompt.agreement)).top).toBeGreaterThan(qr.bottom);
    expect(await overflowOf(prompt.passphrase)).toBeLessThanOrEqual(0);
  });
});

test.describe("upright tablet", () => {
  test.use({ viewport: { height: 1180, width: 820 } });

  // Stacked, the revealed key ran the agreement past an upright tablet's
  // screen; side by side, the whole prompt fits it.
  test("sets the revealed key beside the agreement", async ({ page }) => {
    test.setTimeout(60_000);
    const prompt = await openPrompt(page);
    await expectSideBySide(prompt);
    await expectRevealFillsFrame(page, prompt);
    expect(await overflowOf(prompt.panel)).toBeLessThanOrEqual(0);
    await expect(prompt.continueButton).toBeInViewport();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { height: 800, width: 1280 } });

  // Shorter than the revealed key: the frame scrolls it, and the column
  // beside it stays on screen.
  test("sets the revealed key beside the agreement", async ({ page }) => {
    test.setTimeout(60_000);
    const prompt = await openPrompt(page);
    await expectSideBySide(prompt);
    await expectRevealFillsFrame(page, prompt);
    expect(await overflowOf(prompt.frame)).toBeGreaterThan(0);
    expect(await overflowOf(prompt.panel)).toBeLessThanOrEqual(0);
    await expect(prompt.title).toBeInViewport();
    await expect(prompt.continueButton).toBeInViewport();
  });
});

test.describe("desktop window", () => {
  test.use({ viewport: { height: 900, width: 1440 } });

  // A window is narrower and shorter than the screen it sits on: the layout
  // follows the window, not the screen.
  test("sets the revealed key beside the agreement", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/app/identity-manager/recovery-key");
    await page
      .getByRole("button", { name: "Switch to windowed layout" })
      .first()
      .click();
    const window = page.getByRole("region", {
      exact: true,
      name: "Identity Manager",
    });
    const prompt = await createIdentityToPrompt(page, window);
    await expectSideBySide(prompt);
    await expectRevealFillsFrame(page, prompt);
    await expect(prompt.continueButton).toBeInViewport();
  });
});

test.describe("phone on its side", () => {
  test.use({ viewport: { height: 375, width: 667 } });

  // Too short for the column, so the prompt scrolls as a whole, sized by the
  // column: the key, longer still in a frame this narrow, scrolls in its frame
  // rather than lengthening the prompt and moving the column.
  test("sets the revealed key beside the agreement", async ({ page }) => {
    test.setTimeout(60_000);
    const prompt = await openPrompt(page);
    await expectSideBySide(prompt);
    await expectRevealFillsFrame(page, prompt);
    expect(await overflowOf(prompt.frame)).toBeGreaterThan(0);
  });
});
