import { expect, type Locator, test } from "@playwright/test";
import { openWindowedDesktop } from "./windowedDesktop";

// The window rounds its corners but does not clip its content, so the body
// rounds and clips its own bottom corners whenever it is the window's bottom
// band. DOM tests cannot evaluate the `:has()` rule that decides this, so read
// the radius a real layout computes.
function bodyCorner(window: Locator): Promise<{
  body: string;
  inner: string;
  overflow: string;
}> {
  return window.evaluate((element) => {
    const frame = getComputedStyle(element);
    const body = element.querySelector(".window-body");
    if (!body) throw new Error("window body not rendered");
    const style = getComputedStyle(body);
    const outer = Number.parseFloat(frame.borderBottomLeftRadius);
    const border = Number.parseFloat(frame.borderBottomWidth);
    return {
      body: style.borderBottomLeftRadius,
      inner: `${outer - border}px`,
      overflow: style.overflow,
    };
  });
}

test("a window's body clips its content inside the rounded bottom corners", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openWindowedDesktop(page);

  const pane = page.locator(".pane:not(.pane-hidden)").first();
  await pane.getByRole("button", { name: "System Monitor" }).click();
  const window = pane.locator(".window").first();
  await expect(window).toBeVisible();

  const resting = await bodyCorner(window);
  expect(resting.overflow).toBe("hidden");
  expect(resting.inner).not.toBe("0px");
  expect(resting.body).toBe(resting.inner);

  // A visible status bar becomes the bottom band and takes the corners.
  await window.getByRole("menuitem", { name: "View" }).click();
  await window.getByRole("menuitem", { name: "Move Window" }).click();
  await expect(window.locator(".window-statusbar")).toBeVisible();
  expect((await bodyCorner(window)).body).toBe("0px");
  await page.keyboard.press("Escape");

  // The message clears, and the body rounds its corners again.
  await expect(window.locator(".window-statusbar")).toHaveCount(0, {
    timeout: 5_000,
  });
  expect((await bodyCorner(window)).body).toBe(resting.inner);

  // A maximized window has square corners.
  await window.getByRole("button", { name: "Toggle maximize window" }).click();
  await expect(window).toHaveClass(/window--maximized/);
  expect((await bodyCorner(window)).body).toBe("0px");
});
