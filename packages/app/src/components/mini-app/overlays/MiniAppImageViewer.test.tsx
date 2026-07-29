import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CurrentWindowProvider } from "../../window/CurrentWindowContext";
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

// One press-and-release of a pointer, held still. Two of these in quick
// succession are what the viewer reads as a double-tap / double-click.
function tap(
  stage: HTMLElement,
  input: { pointerId: number; pointerType?: string; timeStamp: number },
) {
  const event = {
    clientX: 10,
    clientY: 10,
    pointerId: input.pointerId,
    pointerType: input.pointerType ?? "touch",
    timeStamp: input.timeStamp,
  };
  fireEvent.pointerDown(stage, event);
  fireEvent.pointerUp(stage, event);
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

test("a window hosts the viewer inside its own bounds", () => {
  const overlayHost = document.createElement("div");
  overlayHost.className = "window";
  document.body.append(overlayHost);

  try {
    const view = render(
      <CurrentWindowProvider
        close={() => undefined}
        id="window-1"
        overlayHost={overlayHost}
        showStatusMessage={() => undefined}
      >
        <MiniAppImageViewer
          label="photo.png"
          onClose={() => undefined}
          url="blob:photo"
        />
      </CurrentWindowProvider>,
    );

    const viewer = view.getByRole("dialog");
    expect(viewer.parentElement).toBe(overlayHost);
    expect(viewer.getAttribute("aria-modal")).toBeNull();
    expect(viewer.classList.contains("mini-app-image-viewer--windowed")).toBe(
      true,
    );
  } finally {
    overlayHost.remove();
  }
});

test("Escape closes only the viewer that owns focus", () => {
  let firstCloses = 0;
  let secondCloses = 0;
  render(
    <>
      <MiniAppImageViewer
        label="first.png"
        onClose={() => (firstCloses += 1)}
        url="blob:first"
      />
      <MiniAppImageViewer
        label="second.png"
        onClose={() => (secondCloses += 1)}
        url="blob:second"
      />
    </>,
  );

  fireEvent.keyDown(document, { key: "Escape" });
  expect(firstCloses).toBe(0);
  expect(secondCloses).toBe(1);
});

test("Escape still closes after interacting with the image stage", () => {
  let closes = 0;
  const { stage } = renderViewer({ onClose: () => (closes += 1) });

  fireEvent.pointerDown(stage, { pointerId: 1, pointerType: "mouse" });
  expect(document.activeElement).toBe(stage.closest("[role=dialog]"));
  fireEvent.keyDown(document, { key: "Escape" });

  expect(closes).toBe(1);
});

// The name is on its own line so the control row stays all controls: at touch
// sizes five 44px targets plus an unnamed blob's id do not share a phone's width.
test("the image's name sits under the control row rather than in it", () => {
  const { view } = renderViewer();

  const toolbar = view.getByRole("toolbar");
  const title = view.getByText("photo.png");
  expect(toolbar.contains(title)).toBe(false);
  expect(
    Array.from(toolbar.children).every((child) => child.tagName === "BUTTON"),
  ).toBe(true);
  // Off the row, but still what names the dialog.
  expect(view.getByRole("dialog").getAttribute("aria-labelledby")).toBe(
    title.id,
  );
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

  tap(stage, { pointerId: 1, pointerType: "mouse", timeStamp: 0 });
  tap(stage, { pointerId: 1, pointerType: "mouse", timeStamp: 100 });
  expect(image.style.transform).toBe("translate(0px, 0px) scale(3)");

  tap(stage, { pointerId: 1, pointerType: "mouse", timeStamp: 400 });
  tap(stage, { pointerId: 1, pointerType: "mouse", timeStamp: 500 });
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
});

// A touch browser synthesizes `dblclick` after two taps. The stage handles the
// taps itself and leaves that event unhandled, so the zoom the double-tap just
// applied survives instead of being toggled straight back off.
test("a synthesized double-click after a double-tap changes nothing", () => {
  const { image, stage } = renderViewer();

  tap(stage, { pointerId: 1, timeStamp: 0 });
  tap(stage, { pointerId: 1, timeStamp: 120 });
  expect(image.style.transform).toBe("translate(0px, 0px) scale(3)");

  fireEvent.doubleClick(stage, { clientX: 10, clientY: 10 });
  expect(image.style.transform).toBe("translate(0px, 0px) scale(3)");
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

  tap(stage, { pointerId: 1, timeStamp: 0 });
  tap(stage, { pointerId: 1, timeStamp: 120 });
  expect((zoomOut as HTMLButtonElement).disabled).toBe(false);
  expect((fit as HTMLButtonElement).disabled).toBe(false);

  fireEvent.click(fit);
  expect(view.getByAltText("photo.png").style.transform).toBe(
    "translate(0px, 0px) scale(1)",
  );
});

test("a pinch does not leave a tap behind for the next one to pair with", () => {
  const { image, stage } = renderViewer();
  const touch = (pointerId: number, timeStamp: number) => ({
    clientX: 10,
    clientY: 10,
    pointerId,
    pointerType: "touch",
    timeStamp,
  });

  // A two-finger pinch whose anchoring finger lifts within the tap slop of where
  // it landed. Neither release is a tap, so the single tap right after it has no
  // partner and must not toggle the zoom.
  fireEvent.pointerDown(stage, touch(1, 0));
  fireEvent.pointerDown(stage, touch(2, 10));
  fireEvent.pointerUp(stage, touch(2, 40));
  fireEvent.pointerUp(stage, touch(1, 50));
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");

  tap(stage, { pointerId: 3, timeStamp: 100 });
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
});

test("a double-tap zooms the point it lands on", () => {
  const { image, stage } = renderViewer();

  tap(stage, { pointerId: 1, timeStamp: 0 });
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");

  tap(stage, { pointerId: 1, timeStamp: 120 });
  expect(image.style.transform).toBe("translate(0px, 0px) scale(3)");
});
