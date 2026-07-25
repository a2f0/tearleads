import { expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import type { SubscribeKeyboardVisibilityFn } from "../../../host/AppHostConfig";
import { useMobileKeyboardVisible } from "./useMobileKeyboardVisible";

class TestVisualViewport extends EventTarget {
  height = window.innerHeight;
  scale = 1;
}

function installVisualViewport(): {
  openKeyboard: () => void;
  closeKeyboard: () => void;
  restore: () => void;
} {
  const original = window.visualViewport;
  const viewport = new TestVisualViewport();
  Reflect.set(window, "visualViewport", viewport);

  const resize = (height: number) => {
    viewport.height = height;
    viewport.dispatchEvent(new Event("resize"));
  };
  return {
    openKeyboard: () => resize(window.innerHeight - 200),
    closeKeyboard: () => resize(window.innerHeight),
    restore: () => Reflect.set(window, "visualViewport", original),
  };
}

function KeyboardState({
  enabled = true,
  subscribeKeyboardVisibility,
}: {
  enabled?: boolean;
  subscribeKeyboardVisibility?: SubscribeKeyboardVisibilityFn;
}) {
  return (
    <output>
      {String(useMobileKeyboardVisible(enabled, subscribeKeyboardVisibility))}
    </output>
  );
}

test("tracks a software keyboard only for editable controls", () => {
  const viewport = installVisualViewport();
  const view = render(<KeyboardState />);
  const textarea = document.createElement("textarea");
  const editable = document.createElement("div");

  try {
    document.body.append(textarea);
    act(() => textarea.focus());
    expect(view.getByText("false")).toBeTruthy();

    act(viewport.openKeyboard);
    expect(view.getByText("true")).toBeTruthy();

    act(viewport.closeKeyboard);
    expect(view.getByText("false")).toBeTruthy();

    editable.contentEditable = "true";
    const editableChild = document.createElement("span");
    editableChild.tabIndex = 0;
    editable.append(editableChild);
    document.body.append(editable);
    act(() => editableChild.focus());
    act(viewport.openKeyboard);
    expect(view.getByText("true")).toBeTruthy();
  } finally {
    textarea.remove();
    editable.remove();
    view.unmount();
    viewport.restore();
  }
});

test("ignores controls that do not summon a software keyboard", () => {
  const viewport = installVisualViewport();
  const view = render(<KeyboardState />);
  const readonlyInput = document.createElement("input");

  try {
    readonlyInput.readOnly = true;
    document.body.append(readonlyInput);
    act(() => readonlyInput.focus());
    act(viewport.openKeyboard);
    expect(view.getByText("false")).toBeTruthy();
  } finally {
    readonlyInput.remove();
    view.unmount();
    viewport.restore();
  }
});

test("recovers when a focused input is removed without a focusout event", () => {
  const viewport = installVisualViewport();
  const view = render(<KeyboardState />);
  const input = document.createElement("input");

  try {
    document.body.append(input);
    act(() => input.focus());
    act(viewport.openKeyboard);
    expect(view.getByText("true")).toBeTruthy();

    input.remove();
    act(viewport.closeKeyboard);
    expect(view.getByText("false")).toBeTruthy();
  } finally {
    input.remove();
    view.unmount();
    viewport.restore();
  }
});

test("stays disabled when the keyboard viewport is reduced", () => {
  const viewport = installVisualViewport();
  const view = render(<KeyboardState enabled={false} />);
  const input = document.createElement("input");

  try {
    document.body.append(input);
    act(() => input.focus());
    act(viewport.openKeyboard);
    expect(view.getByText("false")).toBeTruthy();
  } finally {
    input.remove();
    view.unmount();
    viewport.restore();
  }
});

test("uses an injected native keyboard signal when the WebView resizes", () => {
  let notify: ((visible: boolean) => void) | undefined;
  const subscribe: SubscribeKeyboardVisibilityFn = (listener) => {
    notify = listener;
    return () => {
      notify = undefined;
    };
  };
  const view = render(
    <KeyboardState subscribeKeyboardVisibility={subscribe} />,
  );

  act(() => notify?.(true));
  expect(view.getByText("true")).toBeTruthy();
  act(() => notify?.(false));
  expect(view.getByText("false")).toBeTruthy();
  view.unmount();
  expect(notify).toBeUndefined();
});
