import { useEffect, useState } from "react";

const MIN_KEYBOARD_INSET_PX = 100;
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isTextInputElement(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }

  const input = target.closest("input, textarea");
  if (input instanceof HTMLInputElement) {
    return (
      !input.disabled &&
      !input.readOnly &&
      !NON_TEXT_INPUT_TYPES.has(input.type)
    );
  }
  if (input instanceof HTMLTextAreaElement) {
    return !input.disabled && !input.readOnly;
  }

  return target instanceof HTMLElement && target.isContentEditable;
}

function isSoftwareKeyboardVisible(target: EventTarget | null): boolean {
  const viewport = window.visualViewport;
  return (
    isTextInputElement(target) &&
    viewport !== undefined &&
    viewport !== null &&
    window.innerHeight - viewport.height >= MIN_KEYBOARD_INSET_PX
  );
}

/** Tracks a software keyboard covering the bottom of the mobile viewport. */
export function useMobileKeyboardVisible(enabled: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let subscribed = true;
    const updateFromActiveElement = () => {
      if (subscribed) {
        setVisible(isSoftwareKeyboardVisible(document.activeElement));
      }
    };
    const updateFromFocus = (event: FocusEvent) => {
      setVisible(isSoftwareKeyboardVisible(event.target));
    };
    const updateAfterBlur = () => {
      queueMicrotask(updateFromActiveElement);
    };
    const viewport = window.visualViewport;

    updateFromActiveElement();
    document.addEventListener("focusin", updateFromFocus);
    document.addEventListener("focusout", updateAfterBlur);
    window.addEventListener("resize", updateFromActiveElement);
    viewport?.addEventListener("resize", updateFromActiveElement);
    return () => {
      subscribed = false;
      document.removeEventListener("focusin", updateFromFocus);
      document.removeEventListener("focusout", updateAfterBlur);
      window.removeEventListener("resize", updateFromActiveElement);
      viewport?.removeEventListener("resize", updateFromActiveElement);
    };
  }, [enabled]);

  return enabled && visible;
}
