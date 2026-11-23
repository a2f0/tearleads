import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { measureAttached } from "./domMeasure";
import {
  openWindowedDesktop,
  switchToWindowedDesktop,
} from "./windowedDesktop";

/*
 * A tab strip is chrome, so it spans its surface rather than sitting inset
 * like content: the screen on a phone, the pane beside the rail on a tablet,
 * and the window's sides on the desktop. Inset, its baseline (which reads as
 * the panel's top edge) stopped short of both sides and the strip floated as a
 * card. A strip that opens its surface also sits flush under the app bar or
 * window toolbar. See components/mini-app/layout/MiniAppTabs.css.
 *
 * Measuring the bounding box alone is not enough, and that is the whole reason
 * these tests look the way they do. The bleed is a negative margin, which
 * escapes padding but not a scrollport: where a strip sits inside a scrolling
 * panel, an unhandled bleed still *measures* flush with the surface while being
 * clipped at the leading edge and pushed into local horizontal scroll at the
 * trailing one. So assert what is painted (`elementsFromPoint` at each edge)
 * and that no ancestor scroll container gained horizontal overflow. Cover a
 * strip reached through a scrollport (container Get Info) alongside the plain
 * top-level ones.
 */

interface StripGeometry {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly paintsAtLeftEdge: boolean;
  readonly paintsAtRightEdge: boolean;
  readonly escaped: readonly string[];
}

/** The strip's offsets from the surface (window body or routed pane) edges. */
function readStripGeometry(strip: Locator, what: string) {
  return measureAttached(`tab strip (${what})`, () =>
    strip.evaluate((element): StripGeometry | null => {
      // The Explorer's sections hub remounts within ~300ms of a deep link, so
      // the element the visibility gate resolved can be an orphan by the time
      // this runs, and an orphan's every box is zero.
      if (!element.isConnected) {
        return null;
      }
      const surface =
        element.closest(".window-body") ?? element.closest(".routed-pane-main");
      if (!surface) {
        throw new Error("The tab strip has no window body or routed pane.");
      }
      const box = element.getBoundingClientRect();
      const edges = surface.getBoundingClientRect();
      const midY = Math.round(box.top + box.height / 2);
      const paintsAt = (x: number) =>
        document
          .elementsFromPoint(x, midY)
          .some((hit) => hit.closest(".mini-app-tabs") !== null);
      // The strip must fit inside every scroll container between it and the
      // surface. Deliberately not a scrollWidth check on those ancestors: long
      // unbreakable content (a hash in the System Monitor log) overflows them
      // for reasons that have nothing to do with the strip. Comparing the boxes
      // asks the precise question: did the bleed escape its scrollport?
      const escapesScrollport = (node: Element): boolean => {
        const style = getComputedStyle(node);
        if (style.overflowX === "visible") return false;
        const nodeBox = node.getBoundingClientRect();
        const padLeft =
          nodeBox.left + (Number.parseFloat(style.borderLeftWidth) || 0);
        const padRight =
          nodeBox.right - (Number.parseFloat(style.borderRightWidth) || 0);
        return box.left < padLeft || box.right > padRight;
      };
      const escaped: string[] = [];
      for (
        let node = element.parentElement;
        node && node !== surface;
        node = node.parentElement
      ) {
        if (escapesScrollport(node)) escaped.push(node.className);
      }
      return {
        left: box.left - edges.left,
        right: edges.right - box.right,
        top: box.top - edges.top,
        paintsAtLeftEdge: paintsAt(edges.left + 1),
        paintsAtRightEdge: paintsAt(edges.right - 2),
        escaped,
      };
    }),
  );
}

function expectFullBleed(geometry: StripGeometry, leading: boolean) {
  expect(geometry.left).toBe(0);
  expect(geometry.right).toBe(0);
  expect(geometry.paintsAtLeftEdge).toBe(true);
  expect(geometry.paintsAtRightEdge).toBe(true);
  expect(geometry.escaped).toEqual([]);
  if (leading) {
    expect(geometry.top).toBe(0);
  } else {
    expect(geometry.top).toBeGreaterThan(0);
  }
}

async function openContainerInfo(scope: Page | Locator, page: Page) {
  const rowAction = scope.getByRole("button", {
    name: "Actions for Contacts",
  });
  await expect(rowAction).toBeVisible({ timeout: 30_000 });
  await rowAction.click();
  await page.getByText("Get Info", { exact: true }).first().click();
}

const ROUTED_SURFACES = [
  {
    name: "settings",
    path: "/app/display-properties",
    tab: "Desktop",
    leading: true,
  },
  {
    name: "system monitor",
    path: "/app/system-monitor",
    tab: "Logs",
    leading: true,
  },
  {
    name: "blob browser",
    path: "/app/explorer/blobs",
    tab: "Blob Browser",
    leading: true,
  },
  {
    name: "sync lanes",
    path: "/app/explorer/sync",
    tab: "Sync Lanes",
    leading: true,
  },
  // Below the "Local Backup" heading, and inside a column capped at the form
  // measure on a tablet, which the strip must still escape.
  { name: "backup restore", path: "/app/backup-restore", leading: false },
  // Reached by drilling in rather than by URL, and the one that scrolls inside
  // its own panel: the case a bounding-box-only assertion missed.
  { name: "container info", path: "/app/explorer", leading: false },
] as const;

const ROUTED_TIERS = [
  { name: "phone", width: 599, height: 800 },
  { name: "tablet", width: 900, height: 1000 },
] as const;

for (const tier of ROUTED_TIERS) {
  for (const surface of ROUTED_SURFACES) {
    test(`${tier.name} tab strip spans the pane (${surface.name})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: tier.width, height: tier.height });
      await page.goto(surface.path);
      if (surface.name === "container info") {
        await openContainerInfo(page, page);
      }

      const strip = page.locator(".mini-app-tabs").first();
      await expect(strip).toBeVisible({ timeout: 30_000 });
      if ("tab" in surface) {
        await expect(
          page.getByRole("tab", { name: surface.tab }),
        ).toBeVisible();
      }

      expectFullBleed(
        await readStripGeometry(strip, `${tier.name} ${surface.name}`),
        surface.leading,
      );
    });
  }
}

// The window body pads its content on top of the mini-app root's own padding,
// so a windowed strip has twice the inset to cancel; Settings has no root and
// cancels the window's alone.
test("windowed tab strip spans the window (blob browser)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/explorer/blobs");
  await switchToWindowedDesktop(page);
  const explorer = page
    .locator(".pane:not(.pane-hidden)")
    .first()
    .getByRole("region", { name: "Explorer", exact: true });
  const strip = explorer.locator(".mini-app-tabs");
  await expect(strip).toBeVisible({ timeout: 30_000 });

  expectFullBleed(await readStripGeometry(strip, "windowed blobs"), true);
});

test("windowed tab strip spans the window (container info)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/explorer");
  await switchToWindowedDesktop(page);
  const explorer = page
    .locator(".pane:not(.pane-hidden)")
    .first()
    .getByRole("region", { name: "Explorer", exact: true });
  await openContainerInfo(explorer, page);
  const strip = explorer.locator(".mini-app-tabs");
  await expect(strip).toBeVisible({ timeout: 30_000 });

  expectFullBleed(await readStripGeometry(strip, "windowed info"), false);
});

// Settings reports its own natural size for Fit to Content, so its width sits
// on the panel; the strip still has to reach the sides of a wider window.
test("windowed tab strip spans the window (settings)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWindowedDesktop(page);
  const pane = page.locator(".pane:not(.pane-hidden)").first();
  await pane
    .getByRole("list", { name: "System tray" })
    .getByRole("button", { name: /Switch to .* theme/ })
    .click({ button: "right" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = pane.getByRole("region", { name: "Settings", exact: true });
  const strip = settings.locator(".mini-app-tabs");
  await expect(strip).toBeVisible({ timeout: 30_000 });

  expectFullBleed(await readStripGeometry(strip, "windowed settings"), true);
});
