import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { SIGNED_IN_APP_URL } from "./signedInServer";
import { switchToWindowedDesktop } from "./windowedDesktop";

/*
 * A list a mini-app shows as a view's content runs to the edges of the surface
 * that shows it, as Explorer's item list does (explorer-edge-rules.spec.ts):
 * its column headings and their rule reach both sides of the window's content
 * pane or the routed pane, in every tier, while the headings' text keeps the
 * inset of the content above it. Org Manager's lists sit in a region that
 * scrolls on its own, so this also proves that region does not clip them or
 * scroll sideways. Signed in, because these views need an account.
 */
test.use({ baseURL: SIGNED_IN_APP_URL });

type Host = "phone" | "tablet" | "window";

interface ListView {
  readonly app: string;
  readonly route: string;
}

interface ListFit {
  readonly frameOverflow: number;
  readonly headingLeft: number;
  readonly headingRight: number;
  readonly leadingTextInset: number;
  readonly scrollportOverflow: number;
  readonly surfaceLeft: number;
  readonly surfaceRight: number;
}

const VIEWS: ReadonlyArray<ListView> = [
  { app: "Org Manager", route: "org-manager/directory" },
  { app: "Org Manager", route: "org-manager/groups" },
  { app: "Org Manager", route: "org-manager/grants" },
  { app: "Identity Manager", route: "identity-manager/active-sessions" },
  { app: "Explorer", route: "explorer/sync" },
  { app: "Explorer", route: "explorer/outgoing" },
  { app: "Explorer", route: "explorer/incoming" },
];

const VIEWPORT_WIDTH: Record<Host, number> = {
  phone: 390,
  tablet: 1280,
  window: 1280,
};

const SURFACE: Record<Host, string> = {
  phone: ".routed-pane-main",
  tablet: ".routed-pane-main",
  window: ".window-body-content, .window-sidebar-content",
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

/** The view's list frame, once its headings are on screen. */
async function openList(
  page: Page,
  host: Host,
  view: ListView,
): Promise<Locator> {
  await page.goto(`/app/${view.route}`);
  const scope =
    host === "window"
      ? page
          .locator(".pane:not(.pane-hidden)")
          .first()
          .getByRole("region", { name: view.app, exact: true })
      : page.locator(SURFACE[host]);
  const frame = scope.locator(".mini-app-table-frame").first();
  await expect(frame.locator("thead th").first()).toBeVisible({
    timeout: 60_000,
  });
  await settle(page);
  return frame;
}

function measureList(frame: Locator, host: Host): Promise<ListFit> {
  return frame.evaluate((element, surfaceSelector) => {
    const surface = element.closest(surfaceSelector);
    const root = element.closest(".mini-app-root");
    const heading = element.querySelector("thead tr");
    const leading = heading?.firstElementChild;
    if (!surface || !root || !heading || !leading) {
      throw new Error("Expected a framed list with headings in a mini-app.");
    }
    const scrollport = element.parentElement?.closest(
      ".mini-app-edge-scrollport",
    );
    const headingBox = heading.getBoundingClientRect();
    const surfaceBox = surface.getBoundingClientRect();
    const rootContentLeft =
      root.getBoundingClientRect().left +
      Number.parseFloat(getComputedStyle(root).paddingLeft);
    return {
      frameOverflow: element.scrollWidth - element.clientWidth,
      headingLeft: headingBox.left,
      headingRight: headingBox.right,
      leadingTextInset:
        leading.getBoundingClientRect().left +
        Number.parseFloat(getComputedStyle(leading).paddingLeft) -
        rootContentLeft,
      scrollportOverflow: scrollport
        ? scrollport.scrollWidth - scrollport.clientWidth
        : 0,
      surfaceLeft: surfaceBox.left,
      surfaceRight: surfaceBox.right,
    };
  }, SURFACE[host]);
}

for (const host of ["tablet", "phone", "window"] as const) {
  test(`view lists run to the edges in the ${host} layout`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH[host], height: 900 });
    if (host === "window") {
      await page.goto("/");
      await switchToWindowedDesktop(page);
    }

    for (const view of VIEWS) {
      const fit = await measureList(await openList(page, host, view), host);
      const label = `${view.route} (${host})`;
      expect(fit.headingLeft, label).toBeCloseTo(fit.surfaceLeft, 0);
      expect(fit.headingRight, label).toBeCloseTo(fit.surfaceRight, 0);
      // Running out to the edges added no sideways scroll, here or in a
      // region scrolling around the list (Org Manager's main region).
      expect(fit.frameOverflow, label).toBeLessThanOrEqual(0);
      expect(fit.scrollportOverflow, label).toBeLessThanOrEqual(0);
      // The headings' text keeps the content's inset, a cell's padding in.
      // On a phone the list bleeds and its text sits nearer the edge.
      if (host === "phone") {
        expect(fit.leadingTextInset, label).toBeLessThanOrEqual(0);
      } else {
        expect(fit.leadingTextInset, label).toBeGreaterThan(0);
        expect(fit.leadingTextInset, label).toBeLessThan(16);
      }
    }
  });
}
