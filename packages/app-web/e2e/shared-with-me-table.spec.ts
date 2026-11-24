import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { SIGNED_IN_APP_URL } from "./signedInServer";
import { switchToWindowedDesktop } from "./windowedDesktop";

/*
 * Shared with Me lists folders in Explorer's style, so its column headings are
 * drawn the way Explorer's are: as tall, because both carry the shared column
 * menu in the kebab column's heading, and out to the edges of the surface that
 * shows them, through the shared `mini-app-table-frame--edges`. The headings'
 * text keeps the inset Explorer's has. With no header above it, the list also
 * sits directly under the app bar or window toolbar, with one rule between
 * them rather than a blank band. Signed in, because a signed-out device has no
 * organization to list.
 */
test.use({ baseURL: SIGNED_IN_APP_URL });

type Host = "phone" | "tablet" | "window";

interface HeadingFit {
  readonly frameBorderTop: number;
  readonly frameOverflow: number;
  readonly height: number;
  readonly left: number;
  readonly leadingTextInset: number;
  readonly right: number;
  readonly surfaceLeft: number;
  readonly surfaceRight: number;
  readonly surfaceTop: number;
  readonly top: number;
}

const VIEWPORT_WIDTH: Record<Host, number> = {
  phone: 390,
  tablet: 1280,
  window: 1280,
};

const SURFACE: Record<Host, string> = {
  phone: ".routed-pane-main",
  tablet: ".routed-pane-main",
  window: ".window-body",
};

const ROUTE: Record<"Explorer" | "Shared with Me", string> = {
  Explorer: "explorer",
  "Shared with Me": "shared-with-me",
};

/** Lets a window's or a pane's entrance finish, so boxes are final. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().endTime !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** The app's list frame, once its first row is on screen. */
async function openList(
  page: Page,
  host: Host,
  app: "Explorer" | "Shared with Me",
): Promise<Locator> {
  let scope: Locator;
  if (host === "window") {
    if (app !== "Explorer") {
      await page.locator(".pane-footer-menu-button").first().click();
      await page
        .locator(".menu")
        .getByRole("button", { name: app, exact: true })
        .click();
    }
    scope = page
      .locator(".pane:not(.pane-hidden)")
      .first()
      .getByRole("region", { name: app, exact: true });
  } else {
    await page.goto(`/app/${ROUTE[app]}`);
    scope = page.locator(SURFACE[host]);
  }
  const frame = scope.locator(".mini-app-table-frame").first();
  await expect(frame.locator("tbody tr").first()).toBeVisible({
    timeout: 60_000,
  });
  await settle(page);
  return frame;
}

function measureHeading(frame: Locator, host: Host): Promise<HeadingFit> {
  return frame.evaluate((element, surfaceSelector) => {
    const surface = element.closest(surfaceSelector);
    const heading = element.querySelector("thead tr");
    const leading = heading?.firstElementChild;
    if (!surface || !heading || !leading) {
      throw new Error("Expected a framed table with headings on a surface.");
    }
    const box = heading.getBoundingClientRect();
    const surfaceBox = surface.getBoundingClientRect();
    return {
      frameBorderTop: Number.parseFloat(
        getComputedStyle(element).borderTopWidth,
      ),
      frameOverflow: element.scrollWidth - element.clientWidth,
      height: box.height,
      leadingTextInset:
        leading.getBoundingClientRect().left +
        Number.parseFloat(getComputedStyle(leading).paddingLeft) -
        surfaceBox.left,
      left: box.left,
      right: box.right,
      surfaceLeft: surfaceBox.left,
      surfaceRight: surfaceBox.right,
      surfaceTop: surfaceBox.top,
      top: box.top,
    };
  }, SURFACE[host]);
}

for (const host of ["tablet", "phone", "window"] as const) {
  test(`Shared with Me's headings match Explorer's in the ${host} layout`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH[host], height: 900 });
    if (host === "window") {
      await page.goto("/");
      await switchToWindowedDesktop(page);
    }

    const explorer = await measureHeading(
      await openList(page, host, "Explorer"),
      host,
    );
    const shared = await measureHeading(
      await openList(page, host, "Shared with Me"),
      host,
    );

    expect(shared.height).toBeCloseTo(explorer.height, 0);
    expect(shared.left).toBeCloseTo(shared.surfaceLeft, 0);
    expect(shared.right).toBeCloseTo(shared.surfaceRight, 0);
    expect(shared.frameOverflow).toBeLessThanOrEqual(0);
    expect(shared.leadingTextInset).toBeCloseTo(explorer.leadingTextInset, 0);
    // Flush under the chrome. The routed app bar rules its own bottom edge,
    // so the list drops its top rule there; a window's toolbar has none, so
    // the list's rule is the one line between them.
    const rule = host === "window" ? 1 : 0;
    expect(shared.frameBorderTop).toBe(rule);
    expect(shared.top - shared.surfaceTop).toBeCloseTo(rule, 0);
  });
}
