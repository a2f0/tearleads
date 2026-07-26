import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MiniAppImageViewer } from "./MiniAppImageViewer";

afterEach(cleanup);

function renderViewer(
  overrides: {
    onClose?: (() => void) | undefined;
    onDownload?: (() => void) | undefined;
  } = {},
) {
  const view = render(
    <MiniAppImageViewer
      label="photo.png"
      onClose={overrides.onClose ?? (() => undefined)}
      onDownload={overrides.onDownload}
      url="blob:photo"
    />,
  );
  const image = view.getByAltText("photo.png");
  const stage = image.parentElement;
  if (!stage) {
    throw new Error("expected the image to be mounted inside the stage");
  }

  return { image, stage, view };
}

test("the viewer shows only the image and its toolbar", () => {
  const { image, view } = renderViewer();

  // Portalled to <body>, so it covers the app rather than sitting in the pane.
  expect(image.closest(".mini-app-image-viewer")?.parentElement).toBe(
    document.body,
  );
  expect(image.getAttribute("src")).toBe("blob:photo");
  expect(view.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  // The stage claims touch gestures instead of letting the page pinch-zoom.
  expect(
    image.parentElement?.classList.contains("mini-app-image-viewer-stage"),
  ).toBe(true);
});

test("close is reachable from the toolbar and from Escape", () => {
  let closes = 0;
  const { view } = renderViewer({ onClose: () => (closes += 1) });

  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(closes).toBe(1);

  fireEvent.keyDown(document, { key: "Escape" });
  expect(closes).toBe(2);
});

test("download appears in the toolbar only when the host offers it", () => {
  let downloads = 0;
  const withDownload = renderViewer({ onDownload: () => (downloads += 1) });

  fireEvent.click(withDownload.view.getByRole("button", { name: "Download" }));
  expect(downloads).toBe(1);

  cleanup();
  const withoutDownload = renderViewer();
  expect(
    withoutDownload.view.queryByRole("button", { name: "Download" }),
  ).toBeNull();
});

test("a double-click zooms in and the next one returns to fit", () => {
  const { image, stage } = renderViewer();

  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");

  fireEvent.doubleClick(stage);
  expect(image.style.transform).toBe("translate(0px, 0px) scale(3)");

  fireEvent.doubleClick(stage);
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
});

test("a wheel scroll zooms the image", () => {
  const { image, stage } = renderViewer();

  fireEvent.wheel(stage, { clientX: 40, clientY: 60, deltaY: -400 });
  const zoomedIn = Number(
    /scale\(([\d.]+)\)/.exec(image.style.transform)?.[1] ?? "1",
  );
  expect(zoomedIn).toBeGreaterThan(1);

  // Scrolling back the other way returns to the fitted view (clamped at 1).
  fireEvent.wheel(stage, { clientX: 40, clientY: 60, deltaY: 4000 });
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
});

test("the zoom controls track what the current view allows", () => {
  const { stage, view } = renderViewer();
  const zoomOut = view.getByRole("button", { name: "Zoom out" });
  const fit = view.getByRole("button", { name: "Fit to screen" });

  // Nothing to undo at the fitted view.
  expect((zoomOut as HTMLButtonElement).disabled).toBe(true);
  expect((fit as HTMLButtonElement).disabled).toBe(true);

  fireEvent.doubleClick(stage);
  expect((zoomOut as HTMLButtonElement).disabled).toBe(false);
  expect((fit as HTMLButtonElement).disabled).toBe(false);

  fireEvent.click(fit);
  expect(view.getByAltText("photo.png").style.transform).toBe(
    "translate(0px, 0px) scale(1)",
  );
});

test("a pinch does not leave a tap behind for the next one to pair with", () => {
  const { image, stage } = renderViewer();
  const down = (pointerId: number, timeStamp: number) =>
    fireEvent.pointerDown(stage, {
      clientX: 10,
      clientY: 10,
      pointerId,
      pointerType: "touch",
      timeStamp,
    });
  const up = (pointerId: number, timeStamp: number) =>
    fireEvent.pointerUp(stage, {
      clientX: 10,
      clientY: 10,
      pointerId,
      pointerType: "touch",
      timeStamp,
    });

  // A two-finger pinch whose anchoring finger lifts within the tap slop of where
  // it landed. Neither release is a tap, so the single tap right after it has no
  // partner and must not toggle the zoom.
  down(1, 0);
  down(2, 10);
  up(2, 40);
  up(1, 50);
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");

  down(3, 100);
  up(3, 110);
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
});

test("a double-tap zooms without waiting on a synthesized double-click", () => {
  const { image, stage } = renderViewer();
  const tap = (timeStamp: number) => {
    fireEvent.pointerDown(stage, {
      clientX: 10,
      clientY: 10,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerUp(stage, {
      clientX: 10,
      clientY: 10,
      pointerId: 1,
      pointerType: "touch",
      timeStamp,
    });
  };

  tap(0);
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");

  tap(120);
  expect(image.style.transform).toBe("translate(0px, 0px) scale(3)");
});
