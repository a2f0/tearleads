import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import {
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppField,
  MiniAppFieldGroup,
  MiniAppInput,
  MiniAppSelect,
  MiniAppStatus,
  MiniAppTextarea,
} from "../MiniAppLayout";

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "clipboard",
);

afterEach(() => {
  cleanup();
  if (originalClipboardDescriptor) {
    Object.defineProperty(
      Navigator.prototype,
      "clipboard",
      originalClipboardDescriptor,
    );
  } else {
    delete (Navigator.prototype as { clipboard?: Clipboard }).clipboard;
  }
});

function installClipboard(writeText: Clipboard["writeText"]): void {
  Object.defineProperty(Navigator.prototype, "clipboard", {
    configurable: true,
    get: () => ({ writeText }),
  });
}

test("mini app buttons preserve default type and variant classes", () => {
  const buttonRef = createRef<HTMLButtonElement>();
  const view = render(
    <MiniAppButton
      ref={buttonRef}
      block
      className="custom-button"
      variant="ghost"
    >
      Save
    </MiniAppButton>,
  );

  const button = view.getByRole("button", { name: "Save" });

  expect(button.getAttribute("type")).toBe("button");
  expect(button.className).toBe(
    "mini-app-button mini-app-button--block mini-app-button--ghost custom-button",
  );
  expect(buttonRef.current).toBe(button as HTMLButtonElement);
});

test("mini app clipboard button copies non-empty values after caller click handlers", async () => {
  const copied: string[] = [];
  const clickOrder: string[] = [];
  installClipboard((value) => {
    copied.push(value);
    clickOrder.push("clipboard");
    return Promise.resolve();
  });
  const view = render(
    <MiniAppClipboardButton
      label="Copy user id"
      value=" user-1 "
      onClick={() => clickOrder.push("caller")}
    />,
  );

  const button = view.getByRole("button", { name: "Copy user id" });
  const mouseDownAllowed = fireEvent.mouseDown(button);
  fireEvent.click(button);

  expect(mouseDownAllowed).toBe(false);
  expect(copied).toEqual([" user-1 "]);
  expect(clickOrder).toEqual(["caller", "clipboard"]);
  expect(button.classList.contains("mini-app-icon-button")).toBe(true);
  await waitFor(() => {
    expect(button.classList.contains("mini-app-clipboard-button--copied")).toBe(
      true,
    );
    expect(button.getAttribute("title")).toBe("Copied to clipboard");
  });
});

test("mini app clipboard button disables empty values and respects prevented clicks", () => {
  const copied: string[] = [];
  installClipboard((value) => {
    copied.push(value);
    return Promise.resolve();
  });
  const blankView = render(
    <MiniAppClipboardButton label="Copy blank" value="  " />,
  );

  expect(
    (
      blankView.getByRole("button", {
        name: "Copy blank",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  cleanup();

  const preventedView = render(
    <MiniAppClipboardButton
      label="Copy prevented"
      value="user-2"
      onClick={(event) => event.preventDefault()}
    />,
  );

  fireEvent.click(
    preventedView.getByRole("button", { name: "Copy prevented" }),
  );

  expect(copied).toEqual([]);
});

test("mini app clipboard button resolves a function value at click time", () => {
  const copied: string[] = [];
  installClipboard((value) => {
    copied.push(value);
    return Promise.resolve();
  });
  let current = "first";
  const view = render(
    <MiniAppClipboardButton label="Copy lazy" value={() => current} />,
  );

  const button = view.getByRole("button", {
    name: "Copy lazy",
  }) as HTMLButtonElement;

  // Enabled without ever resolving the value: emptiness cannot be checked
  // without doing the work the laziness exists to avoid.
  expect(button.disabled).toBe(false);

  fireEvent.click(button);
  current = "second";
  fireEvent.click(button);

  // Each click copies what the builder returns at that moment, not a value
  // captured at render.
  expect(copied).toEqual(["first", "second"]);
});

test("mini app clipboard button skips a function value that resolves empty", () => {
  const copied: string[] = [];
  installClipboard((value) => {
    copied.push(value);
    return Promise.resolve();
  });
  const view = render(
    <MiniAppClipboardButton label="Copy empty lazy" value={() => "  "} />,
  );

  fireEvent.click(view.getByRole("button", { name: "Copy empty lazy" }));

  expect(copied).toEqual([]);
});

test("mini app form controls preserve class names and forwarded refs", () => {
  const inputRef = createRef<HTMLInputElement>();
  const selectRef = createRef<HTMLSelectElement>();
  const textareaRef = createRef<HTMLTextAreaElement>();
  const view = render(
    <MiniAppField className="custom-field">
      <span>Name</span>
      <MiniAppInput ref={inputRef} className="custom-input" />
      <MiniAppSelect ref={selectRef} className="custom-select" />
      <MiniAppTextarea ref={textareaRef} className="custom-textarea" />
    </MiniAppField>,
  );

  const field = view.container.querySelector("label");

  expect(field?.className).toBe("mini-app-field custom-field");
  expect(inputRef.current?.className).toBe("mini-app-input custom-input");
  expect(selectRef.current?.className).toBe("mini-app-select custom-select");
  expect(textareaRef.current?.className).toBe(
    "mini-app-textarea custom-textarea",
  );
});

test("mini app field group shares field styling without nesting controls in a label", () => {
  const view = render(
    <MiniAppFieldGroup className="custom-field-group">
      <span>Choice</span>
      <button type="button">Choose</button>
    </MiniAppFieldGroup>,
  );

  const fieldGroup = view.container.querySelector("div");

  expect(fieldGroup?.className).toBe("mini-app-field custom-field-group");
  expect(fieldGroup?.querySelector("label")).toBeNull();
});

test("mini app status preserves element choice and tone classes", () => {
  const view = render(
    <MiniAppStatus as="span" className="custom-status" tone="error">
      Error
    </MiniAppStatus>,
  );

  const status = view.getByText("Error");

  expect(status.tagName).toBe("SPAN");
  expect(status.className).toBe(
    "mini-app-status mini-app-status--error custom-status",
  );
});
