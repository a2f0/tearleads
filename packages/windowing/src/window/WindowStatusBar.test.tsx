import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { WindowStatusBar } from "./WindowStatusBar";

afterEach(cleanup);

test("renders no visible bar without a status message", () => {
  const view = render(<WindowStatusBar />);

  expect(view.container.querySelector(".window-statusbar")).toBeNull();
});

test("renders the bar while a status message is showing", () => {
  const view = render(<WindowStatusBar text="Saved." />);

  const bar = view.container.querySelector(".window-statusbar");
  expect(bar).toBeTruthy();
  expect(bar?.textContent).toBe("Saved.");
});

test("keeps the live region mounted so messages are announced", () => {
  // A live region only announces when text changes on an already-mounted
  // element, so the region must outlive any individual message.
  const view = render(<WindowStatusBar />);
  const region = view.getByRole("status");

  view.rerender(<WindowStatusBar text="Saved." />);

  expect(view.getByRole("status")).toBe(region);
  expect(region.textContent).toBe("Saved.");
});
