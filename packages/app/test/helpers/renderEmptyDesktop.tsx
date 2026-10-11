import { expect } from "bun:test";
import {
  fireEvent,
  type RenderResult,
  render,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";

// Mini-app tests open their own windows. Close the startup Explorer through
// its chrome to give these fixtures an empty desktop; App.layout.test covers
// the production startup and mode-switch defaults.
export function renderEmptyDesktop(element: ReactElement): RenderResult {
  const view = render(element);
  for (const windowElement of view.container.querySelectorAll<HTMLElement>(
    ".window",
  )) {
    expect(
      windowElement.querySelector(".window-titlebar-title")?.textContent,
    ).toBe("Explorer");
    fireEvent.click(
      within(windowElement).getByRole("button", { name: "Close window" }),
    );
  }
  return view;
}
