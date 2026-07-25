import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createAppHostConfig, type Scanner } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../providers/host/AppHostConfigProvider";
import { ContactAvatarControl } from "./ContactAvatarControl";

afterEach(cleanup);

function renderControl(
  props: Partial<Parameters<typeof ContactAvatarControl>[0]> = {},
  scanner?: Scanner,
) {
  return render(
    <AppHostConfigProvider
      value={createAppHostConfig({
        apiBaseUrl: "http://api.example.test",
        createScanner: scanner ? () => scanner : undefined,
        wsUrl: "ws://api.example.test/events",
      })}
    >
      <ContactAvatarControl
        avatarUrl={null}
        canEdit
        displayName="Ada Lovelace"
        hasAvatar={false}
        onApplyAvatar={() => undefined}
        onRemoveAvatar={() => undefined}
        {...props}
      />
    </AppHostConfigProvider>,
  );
}

test("hides the avatar actions outside edit mode", () => {
  const view = renderControl({ canEdit: false });

  expect(view.queryByRole("button", { name: "Set Avatar" })).toBeNull();
  expect(view.queryByRole("button", { name: "Remove Avatar" })).toBeNull();
});

test("offers set without an avatar and replace or remove with one", () => {
  const view = renderControl();
  expect(view.getByRole("button", { name: "Set Avatar" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Remove Avatar" })).toBeNull();

  const removed: boolean[] = [];
  const replaceView = renderControl({
    avatarUrl: "blob:avatar",
    hasAvatar: true,
    onRemoveAvatar: () => removed.push(true),
  });
  expect(
    replaceView.getByRole("button", { name: "Replace Avatar" }),
  ).toBeTruthy();
  fireEvent.click(replaceView.getByRole("button", { name: "Remove Avatar" }));
  expect(removed).toEqual([true]);
});

test("opens the crop editor for a picked image and cancels back out", () => {
  const view = renderControl();
  const file = new File(["fake-image"], "photo.png", { type: "image/png" });

  fireEvent.change(view.getByLabelText("Set Avatar"), {
    target: { files: [file] },
  });

  const dialog = view.getByRole("dialog");
  expect(dialog).toBeTruthy();
  // Apply stays disabled until the source image reports its dimensions.
  expect(
    (view.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled,
  ).toBe(true);

  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(view.queryByRole("dialog")).toBeNull();
});

test("enables zoom and apply once the source image loads", () => {
  const view = renderControl();
  const file = new File(["fake-image"], "photo.png", { type: "image/png" });

  fireEvent.change(view.getByLabelText("Set Avatar"), {
    target: { files: [file] },
  });

  const image = view
    .getByRole("dialog")
    .querySelector(".contact-avatar-editor-image");
  if (!image) {
    throw new Error("Editor image not rendered.");
  }
  Object.defineProperty(image, "naturalWidth", { value: 800 });
  Object.defineProperty(image, "naturalHeight", { value: 600 });
  fireEvent.load(image);

  expect((view.getByLabelText("Zoom") as HTMLInputElement).disabled).toBe(
    false,
  );
  expect(
    (view.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

test("opens the crop editor with a photo captured by the scanner", async () => {
  const photo = new Blob(["camera-image"], { type: "image/jpeg" });
  const view = renderControl({}, { capturePhoto: async () => photo });

  expect(view.getByRole("button", { name: "Take Photo" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Choose Photo" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Take Photo" }));

  await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
});

test("treats dismissing the scanner as cancellation", async () => {
  const view = renderControl({}, { capturePhoto: async () => null });

  fireEvent.click(view.getByRole("button", { name: "Take Photo" }));

  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Take Photo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.queryByRole("alert")).toBeNull();
});

test("surfaces scanner failures without opening the editor", async () => {
  const view = renderControl(
    {},
    {
      capturePhoto: async () => {
        throw new Error("Camera permission denied");
      },
    },
  );

  fireEvent.click(view.getByRole("button", { name: "Take Photo" }));

  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain(
      "Could not capture a photo",
    ),
  );
  expect(view.queryByRole("dialog")).toBeNull();
});
