import { useEffect, useState } from "react";
import type { SubscribeKeyboardVisibilityFn } from "../../../host/AppHostConfig";

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
  if (target instanceof HTMLInputElement) {
    return (
      !target.disabled &&
      !target.readOnly &&
      !NON_TEXT_INPUT_TYPES.has(target.type)
    );
  }
  if (target instanceof HTMLTextAreaElement) {
    return !target.disabled && !target.readOnly;
  }

  return target instanceof HTMLElement && target.isContentEditable;
}

function isSoftwareKeyboardVisible(target: EventTarget | null): boolean {
  const viewport = window.visualViewport;
  return (
    isTextInputElement(target) &&
    viewport !== undefined &&
    viewport !== null &&
    viewport.scale <= 1 &&
    window.innerHeight - viewport.height >= MIN_KEYBOARD_INSET_PX
  );
}

/** Tracks a software keyboard covering the bottom of the mobile viewport. */
export function useMobileKeyboardVisible(
  enabled: boolean,
  subscribeKeyboardVisibility?: SubscribeKeyboardVisibilityFn | undefined,
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }

    if (subscribeKeyboardVisibility) {
      return subscribeKeyboardVisibility(setVisible);
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
    const updateAfterBlur = (event: FocusEvent) => {
      if (event.relatedTarget !== null) {
        setVisible(isSoftwareKeyboardVisible(event.relatedTarget));
      } else {
        queueMicrotask(updateFromActiveElement);
      }
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
  }, [enabled, subscribeKeyboardVisibility]);

  return enabled && visible;
}
