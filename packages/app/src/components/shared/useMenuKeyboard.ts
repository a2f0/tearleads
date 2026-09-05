import { type RefObject, useEffect, useEffectEvent } from "react";

function nextControl(
  controls: HTMLElement[],
  focused: Element | null,
  key: string,
) {
  if (controls.length === 0) return undefined;
  const index = focused instanceof HTMLElement ? controls.indexOf(focused) : -1;
  switch (key) {
    case "ArrowDown":
      return controls[(index + 1) % controls.length];
    case "ArrowUp":
      return controls[
        index < 0
          ? controls.length - 1
          : (index - 1 + controls.length) % controls.length
      ];
    case "Home":
      return controls[0];
    case "End":
      return controls.at(-1);
    default:
      return undefined;
  }
}

export function useMenuKeyboard(
  menuRef: RefObject<HTMLDivElement | null>,
  ready: boolean,
  onClose: () => void,
) {
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const menu = menuRef.current;
    if (!ready || !menu) return;

    const trigger = document.activeElement;
    let dismissedByPointer = false;
    const items = () =>
      Array.from(
        menu.querySelectorAll<HTMLElement>(
          ":is(button, input[type=checkbox]):not(:disabled):not([hidden])",
        ),
      );
    const focusFirst = () =>
      (items()[0] ?? menu).focus({ preventScroll: true });
    focusFirst();
    // Startup and sync can replace an action while its menu is open. Recover
    // focus only when that replacement dropped it onto the document body.
    const observer = new MutationObserver(() => {
      if (!dismissedByPointer && document.activeElement === document.body) {
        focusFirst();
      }
    });
    observer.observe(menu, { childList: true, subtree: true });

    function restoreFocus() {
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
        return document.activeElement === trigger && trigger !== document.body;
      }
      return false;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!menu?.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        restoreFocus();
        close();
        return;
      }
      if (event.key === "Tab") {
        if (!restoreFocus()) event.preventDefault();
        close();
        return;
      }
      const next = nextControl(items(), document.activeElement, event.key);
      if (next) {
        event.preventDefault();
        event.stopPropagation();
        next.focus();
      }
    }

    function handleMouseDown(event: MouseEvent) {
      dismissedByPointer =
        event.target instanceof Node && !menu?.contains(event.target);
    }

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (
        !dismissedByPointer &&
        (menu.contains(document.activeElement) ||
          document.activeElement === document.body)
      ) {
        restoreFocus();
      }
    };
  }, [menuRef, ready]);
}
