import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { TEST_SYSTEM_WARNING, TestSystemBanner } from "./TestSystemBanner";

afterEach(() => cleanup());

test("states the deployment warning beside a warning glyph", () => {
  const { container } = render(<TestSystemBanner />);
  const banner = container.querySelector(".test-system-banner");

  expect(banner?.textContent).toBe(TEST_SYSTEM_WARNING);
  // The glyph is decoration for the sentence it sits beside, so it must not be
  // announced a second time as an image.
  expect(banner?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
});

test("hides on request without unmounting", () => {
  const { container } = render(<TestSystemBanner hidden />);
  const banner = container.querySelector(".test-system-banner");

  expect(banner).toBeTruthy();
  expect(banner?.hasAttribute("hidden")).toBe(true);
});
