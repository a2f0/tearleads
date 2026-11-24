import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { openWindowedDesktop } from "./windowedDesktop";

/*
 * The Explorer's rules run to the edges of the surface that shows it, in a
 * window and in the routed shell alike: a folder listing's column headings, the
 * rule above them, and its row lines; and the rule under a document's title,
 * whatever the document type. Only the lines move. The listing's text and
 * kebabs and a document's fields keep the inset they had, which here means
 * lining up with the folder or document header above them.
 *
 * Phones already drew the listing this way, with its text nearer the edge, and
 * are covered by explorer-item-views.spec.ts.
 */

type Host = "routed" | "window";

interface Span {
  readonly left: number;
  readonly right: number;
}

interface ListingFit {
  readonly frameOverflow: number;
  readonly headerLeft: number;
  readonly headerKebabRight: number;
  readonly headingRow: Span;
  readonly leadingTextLeft: number;
  readonly row: Span;
  readonly rowKebabRight: number;
  readonly surface: Span;
}

interface DocumentFit {
  readonly fieldLeft: number;
  readonly rule: Span;
  readonly surface: Span;
  readonly titleLeft: number;
}

const SURFACE: Record<Host, string> = {
  routed: ".routed-pane-main",
  window: ".window-body",
};

/** The Explorer's surface, and where its toolbar buttons are. */
async function openExplorer(
  page: Page,
  host: Host,
): Promise<{ controls: Locator | Page; scope: Locator }> {
  await page.setViewportSize({ width: 1280, height: 900 });
  if (host === "routed") {
    await page.goto("/app/explorer");
    return { controls: page, scope: page.locator(SURFACE.routed) };
  }
  await openWindowedDesktop(page);
  await page.locator(".pane-footer-menu-button").first().click();
  await page
    .locator(".menu")
    .getByRole("button", { name: "Explorer", exact: true })
    .click();
  const window = page.locator(".window").first();
  return { controls: window, scope: window };
}

function measureListing(scope: Locator, host: Host): Promise<ListingFit> {
  return scope
    .locator(".explorer-item-table-wrap")
    .evaluate((frame, surfaceSelector) => {
      const surface = frame.closest(surfaceSelector);
      const header = frame
        .closest(".explorer-detail--container")
        ?.querySelector(".mini-app-header");
      const headerKebab = header?.querySelector(".mini-app-row-actions-button");
      const headingRow = frame.querySelector("thead tr");
      const leadingHeading = headingRow?.firstElementChild;
      const row = frame.querySelector("tbody tr.explorer-item-table-row");
      const rowKebab = row?.querySelector(".mini-app-row-actions-button");
      if (
        !surface ||
        !header ||
        !headerKebab ||
        !headingRow ||
        !leadingHeading ||
        !row ||
        !rowKebab
      ) {
        throw new Error("Expected a folder listing with a row under a header.");
      }
      const span = (element: Element) => {
        const { left, right } = element.getBoundingClientRect();
        return { left, right };
      };
      return {
        frameOverflow: frame.scrollWidth - frame.clientWidth,
        headerKebabRight: headerKebab.getBoundingClientRect().right,
        headerLeft: header.getBoundingClientRect().left,
        headingRow: span(headingRow),
        leadingTextLeft:
          leadingHeading.getBoundingClientRect().left +
          Number.parseFloat(getComputedStyle(leadingHeading).paddingLeft),
        row: span(row),
        rowKebabRight: rowKebab.getBoundingClientRect().right,
        surface: span(surface),
      };
    }, SURFACE[host]);
}

function measureDocument(scope: Locator, host: Host): Promise<DocumentFit> {
  return scope
    .locator(".explorer-inline-note")
    .evaluate((pane, surfaceSelector) => {
      const surface = pane.closest(surfaceSelector);
      const title = pane
        .closest(".explorer-detail--note")
        ?.querySelector(".mini-app-header");
      // The first field on screen; the avatar's file input is hidden.
      const field = Array.from(pane.querySelectorAll("input")).find(
        (input) => input.getBoundingClientRect().width > 0,
      );
      if (!surface || !title || !field) {
        throw new Error("Expected a document with fields under its title.");
      }
      const { left, right } = pane.getBoundingClientRect();
      return {
        fieldLeft: field.getBoundingClientRect().left,
        rule: { left, right },
        surface: {
          left: surface.getBoundingClientRect().left,
          right: surface.getBoundingClientRect().right,
        },
        titleLeft: title.getBoundingClientRect().left,
      };
    }, SURFACE[host]);
}

function expectSpansSurface(span: Span, surface: Span): void {
  expect(span.left).toBeCloseTo(surface.left, 0);
  expect(span.right).toBeCloseTo(surface.right, 0);
}

for (const host of ["routed", "window"] as const) {
  test(`a folder listing's headings and rows span the ${host} surface`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { scope } = await openExplorer(page, host);
    await expect(
      scope.locator("tbody tr.explorer-item-table-row").first(),
    ).toBeVisible({ timeout: 30_000 });

    const fit = await measureListing(scope, host);
    expectSpansSurface(fit.headingRow, fit.surface);
    expectSpansSurface(fit.row, fit.surface);
    // Running out to the edges added no sideways scroll.
    expect(fit.frameOverflow).toBeLessThanOrEqual(0);
    // The text and kebabs stayed put: the leading heading's text starts a
    // cell's padding in from the folder header, and the row kebabs keep to
    // the header kebab's trailing edge.
    expect(fit.leadingTextLeft - fit.headerLeft).toBeGreaterThan(0);
    expect(fit.leadingTextLeft - fit.headerLeft).toBeLessThan(16);
    expect(Math.abs(fit.rowKebabRight - fit.headerKebabRight)).toBeLessThan(
      2.5,
    );
  });

  test(`a document's title rule spans the ${host} surface`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { controls, scope } = await openExplorer(page, host);
    await controls
      .getByRole("button", { name: "New Document" })
      .first()
      .click();
    await controls
      .getByRole("button", { name: "Contact", exact: true })
      .click();
    await expect(
      scope.locator(".explorer-inline-note input").first(),
    ).toBeVisible({ timeout: 30_000 });

    const fit = await measureDocument(scope, host);
    expectSpansSurface(fit.rule, fit.surface);
    // The contact's fields keep their inset, under the title.
    expect(fit.fieldLeft).toBeCloseTo(fit.titleLeft, 0);
  });
}
