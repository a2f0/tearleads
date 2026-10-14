import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { useRef, useState } from "react";

GlobalRegistrator.register();
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { ScreenshotsViewport } = await import("./ScreenshotsViewport");

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function Viewer() {
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  return (
    <ScreenshotsViewport
      expanded={expanded}
      onCollapse={() => setExpanded(false)}
      toggleRef={toggleRef}
    >
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Collapse viewer" : "Expand viewer"}
      </button>
      <dialog open aria-label="Image zoom">
        <button type="button">Close image zoom</button>
      </dialog>
    </ScreenshotsViewport>
  );
}

function expandedViewer() {
  const view = render(<Viewer />);
  fireEvent.click(view.getByRole("button", { name: "Expand viewer" }));
  return view;
}

test("expanding opens the modal, focuses its toggle and locks page scrolling", () => {
  const view = expandedViewer();
  expect(
    view
      .getByRole("dialog", { name: "Screenshot viewer" })
      .hasAttribute("open"),
  ).toBe(true);
  expect(document.activeElement).toBe(
    view.getByRole("button", { name: "Collapse viewer" }),
  );
  expect(document.body.style.overflow).toBe("hidden");
});

for (const action of ["toggle", "cancel", "close"] as const) {
  test(`${action} collapses the viewer, restores focus and restores scrolling`, () => {
    document.body.style.overflow = "auto";
    const view = expandedViewer();
    const dialog = view.getByRole("dialog", { name: "Screenshot viewer" });
    if (action === "toggle") {
      fireEvent.click(view.getByRole("button", { name: "Collapse viewer" }));
    } else if (action === "cancel") {
      // Prevent the browser hiding the dialog before React restores the gallery.
      expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(
        false,
      );
    } else {
      fireEvent(dialog, new Event("close"));
    }
    expect(
      view.queryByRole("dialog", { name: "Screenshot viewer" }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Expand viewer" }),
    );
    expect(document.body.style.overflow).toBe("auto");
  });
}

test("closing the nested image dialog leaves the gallery expanded", () => {
  const view = expandedViewer();
  const zoom = view.getByRole("dialog", { name: "Image zoom" });
  expect(fireEvent(zoom, new Event("cancel", { cancelable: true }))).toBe(true);
  fireEvent(zoom, new Event("close"));
  expect(
    view
      .getByRole("dialog", { name: "Screenshot viewer" })
      .hasAttribute("open"),
  ).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
});

test("unmounting the expanded gallery restores page scrolling", () => {
  document.body.style.overflow = "scroll";
  const view = expandedViewer();
  view.unmount();
  expect(document.body.style.overflow).toBe("scroll");
});
