import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WindowSidebar } from "./WindowSidebar";

afterEach(() => cleanup());

test("sidebar resize handle exposes separator semantics", () => {
  const view = render(
    <WindowSidebar sidebar={<div>Sidebar</div>}>
      <div>Content</div>
    </WindowSidebar>,
  );

  const handle = view.getByRole("separator", { name: "Resize sidebar" });

  expect(handle.getAttribute("aria-orientation")).toBe("vertical");
  expect(handle.getAttribute("aria-valuemin")).toBe("80");
  expect(handle.getAttribute("aria-valuemax")).toBe("400");
  expect(handle.getAttribute("aria-valuenow")).toBe("160");
});

test("sidebar resize handle supports keyboard resizing", () => {
  const view = render(
    <WindowSidebar sidebar={<div>Sidebar</div>}>
      <div>Content</div>
    </WindowSidebar>,
  );
  const handle = view.getByRole("separator", { name: "Resize sidebar" });

  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle.getAttribute("aria-valuenow")).toBe("170");

  fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
  expect(handle.getAttribute("aria-valuenow")).toBe("120");

  fireEvent.keyDown(handle, { key: "Home" });
  expect(handle.getAttribute("aria-valuenow")).toBe("80");

  fireEvent.keyDown(handle, { key: "End" });
  expect(handle.getAttribute("aria-valuenow")).toBe("400");
});
