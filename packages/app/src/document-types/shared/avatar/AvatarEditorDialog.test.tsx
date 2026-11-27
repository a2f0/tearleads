import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AvatarEditorDialog } from "./AvatarEditorDialog";

afterEach(cleanup);

test("avatar editor focuses cancel, closes on Escape when idle, and restores focus", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();

  try {
    let cancelCount = 0;
    const view = render(
      <AvatarEditorDialog
        onCancel={() => {
          cancelCount += 1;
        }}
        onConfirm={() => undefined}
        source={new Blob(["avatar"], { type: "image/png" })}
        title="Edit photo"
      />,
    );

    const slider = view.getByRole("slider", { name: "Zoom" });
    expect(slider.classList.contains("mini-app-range")).toBe(true);
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Cancel" }),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancelCount).toBe(1);

    view.unmount();
    expect(document.activeElement).toBe(opener);
  } finally {
    opener.remove();
  }
});

test("avatar editor ignores Escape while saving a cropped avatar", async () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  let resolveBlob: ((blob: Blob | null) => void) | null = null;

  HTMLCanvasElement.prototype.getContext = (() => ({
    clearRect: () => undefined,
    drawImage: () => undefined,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = ((callback: BlobCallback) => {
    resolveBlob = callback;
  }) as typeof HTMLCanvasElement.prototype.toBlob;

  try {
    let cancelCount = 0;
    const confirmed: Blob[] = [];
    const view = render(
      <AvatarEditorDialog
        onCancel={() => {
          cancelCount += 1;
        }}
        onConfirm={(blob) => {
          confirmed.push(blob);
        }}
        source={new Blob(["avatar"], { type: "image/png" })}
        title="Edit photo"
      />,
    );

    const image = view.container.querySelector("img");
    if (!image) {
      throw new Error("Expected avatar preview image.");
    }
    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(image, "naturalHeight", {
      configurable: true,
      value: 200,
    });
    fireEvent.load(image);

    fireEvent.click(view.getByRole("button", { name: "Apply" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancelCount).toBe(0);

    const encoded = new Blob(["cropped"], { type: "image/webp" });
    await act(async () => {
      resolveBlob?.(encoded);
      await Promise.resolve();
    });
    expect(confirmed).toEqual([encoded]);
  } finally {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
  }
});
