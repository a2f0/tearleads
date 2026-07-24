import { useEffect, useState } from "react";

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

  const editable = target.closest("input, textarea, [contenteditable]");
  if (editable instanceof HTMLInputElement) {
    return (
      !editable.disabled &&
      !editable.readOnly &&
      !NON_TEXT_INPUT_TYPES.has(editable.type)
    );
  }
  if (editable instanceof HTMLTextAreaElement) {
    return !editable.disabled && !editable.readOnly;
  }

  return (
    editable instanceof HTMLElement &&
    editable.contentEditable.toLowerCase() !== "false"
  );
}

/** Tracks focus on controls that can summon a mobile software keyboard. */
export function useTextInputFocused(enabled: boolean): boolean {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const updateFromTarget = (event: FocusEvent) => {
      const target =
        event.type === "focusout" ? event.relatedTarget : event.target;
      setFocused(isTextInputElement(target));
    };

    setFocused(isTextInputElement(document.activeElement));
    document.addEventListener("focusin", updateFromTarget);
    document.addEventListener("focusout", updateFromTarget);
    return () => {
      document.removeEventListener("focusin", updateFromTarget);
      document.removeEventListener("focusout", updateFromTarget);
    };
  }, [enabled]);

  return enabled && focused;
}
