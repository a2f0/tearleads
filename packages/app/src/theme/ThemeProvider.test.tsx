import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeToggleButton } from "./ThemeToggleButton";

const STORAGE_KEY = "tearleads.theme";

afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem(STORAGE_KEY);
  document.documentElement.removeAttribute("data-theme");
});

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggleButton />
    </ThemeProvider>,
  );
}

test("defaults to Light, stamps the root, and labels the toggle for the next theme", () => {
  const view = renderToggle();

  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(view.getByRole("button").getAttribute("aria-label")).toBe(
    "Switch to Dark theme",
  );
});

test("toggling advances the theme, persists it, and restamps the root", () => {
  const view = renderToggle();

  fireEvent.click(view.getByRole("button"));

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe("dark");
  expect(view.getByRole("button").getAttribute("aria-label")).toBe(
    "Switch to Light theme",
  );
});

test("restores the persisted theme on mount", () => {
  globalThis.localStorage.setItem(STORAGE_KEY, "dark");

  const view = renderToggle();

  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(view.getByRole("button").getAttribute("aria-label")).toBe(
    "Switch to Light theme",
  );
});

test("ThemeToggleButton renders nothing without a ThemeProvider", () => {
  const view = render(<ThemeToggleButton />);

  expect(view.queryByRole("button")).toBe(null);
});
