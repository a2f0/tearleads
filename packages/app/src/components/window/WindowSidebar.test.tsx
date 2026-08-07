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

test("sidebar resize handle supports primary pointer dragging", () => {
  const view = render(
    <WindowSidebar sidebar={<div>Sidebar</div>}>
      <div>Content</div>
    </WindowSidebar>,
  );
  const handle = view.getByRole("separator", { name: "Resize sidebar" });

  fireEvent.pointerDown(handle, {
    button: 2,
    clientX: 100,
    isPrimary: true,
    pointerId: 1,
  });
  fireEvent.pointerMove(document, { clientX: 136, pointerId: 1 });
  expect(handle.getAttribute("aria-valuenow")).toBe("160");

  fireEvent.pointerDown(handle, {
    button: 0,
    clientX: 100,
    isPrimary: true,
    pointerId: 2,
    pointerType: "touch",
  });
  expect(document.body.style.cursor).toBe("col-resize");
  expect(document.body.style.userSelect).toBe("none");

  fireEvent.pointerDown(handle, {
    button: 0,
    clientX: 200,
    isPrimary: false,
    pointerId: 3,
    pointerType: "touch",
  });
  fireEvent.pointerMove(document, { clientX: 236, pointerId: 3 });
  expect(handle.getAttribute("aria-valuenow")).toBe("160");
  fireEvent.pointerMove(document, { clientX: 136, pointerId: 1 });
  expect(handle.getAttribute("aria-valuenow")).toBe("160");
  fireEvent.pointerMove(document, { clientX: 136, pointerId: 2 });
  expect(handle.getAttribute("aria-valuenow")).toBe("196");
  fireEvent.pointerMove(document, { clientX: 1_000, pointerId: 2 });
  expect(handle.getAttribute("aria-valuenow")).toBe("400");
  fireEvent.pointerMove(document, { clientX: -1_000, pointerId: 2 });
  expect(handle.getAttribute("aria-valuenow")).toBe("80");

  fireEvent.pointerCancel(document, { pointerId: 2 });
  expect(document.body.style.cursor).toBe("");
  expect(document.body.style.userSelect).toBe("");

  fireEvent.pointerDown(handle, {
    button: 0,
    clientX: 100,
    isPrimary: true,
    pointerId: 4,
  });
  view.unmount();
  expect(document.body.style.cursor).toBe("");
  expect(document.body.style.userSelect).toBe("");
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
