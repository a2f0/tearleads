import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { RoutedPaneSidebar } from "./RoutedPaneSidebar";

afterEach(() => cleanup());

test("tablet sidebar resize handle supports pointer dragging", () => {
  const view = render(
    <RoutedPaneSidebar onClose={() => {}} tier="tablet">
      <div>Sidebar</div>
    </RoutedPaneSidebar>,
  );

  const handle = view.getByRole("separator", { name: "Resize sidebar" });

  expect(handle.getAttribute("aria-orientation")).toBe("vertical");
  expect(handle.getAttribute("aria-valuemin")).toBe("80");
  expect(handle.getAttribute("aria-valuemax")).toBe("400");
  expect(handle.getAttribute("aria-valuenow")).toBe("224");

  fireEvent.pointerDown(handle, {
    button: 0,
    clientX: 100,
    isPrimary: true,
    pointerId: 1,
  });
  fireEvent.pointerMove(document, { clientX: 136, pointerId: 1 });

  expect(handle.getAttribute("aria-valuenow")).toBe("260");
});

test("tablet sidebar resize handle supports keyboard resizing", () => {
  const view = render(
    <RoutedPaneSidebar onClose={() => {}} tier="tablet">
      <div>Sidebar</div>
    </RoutedPaneSidebar>,
  );

  const handle = view.getByRole("separator", { name: "Resize sidebar" });

  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle.getAttribute("aria-valuenow")).toBe("234");

  fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
  expect(handle.getAttribute("aria-valuenow")).toBe("184");

  fireEvent.keyDown(handle, { key: "Home" });
  expect(handle.getAttribute("aria-valuenow")).toBe("80");

  fireEvent.keyDown(handle, { key: "End" });
  expect(handle.getAttribute("aria-valuenow")).toBe("400");
});

test("mobile sidebar remains a closeable overlay without a resize handle", () => {
  const view = render(
    <RoutedPaneSidebar onClose={() => {}} tier="mobile">
      <div>Sidebar</div>
    </RoutedPaneSidebar>,
  );

  expect(view.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();
  expect(view.getByRole("dialog")).toBeTruthy();
  expect(view.getByRole("button", { name: "Close sidebar" })).toBeTruthy();
});
