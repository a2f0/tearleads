import { type RefObject, useEffect, useEffectEvent } from "react";

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
    const items = () =>
      Array.from(
        menu.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled):not([hidden])",
        ),
      );
    items()[0]?.focus({ preventScroll: true });
    // Startup and sync can replace an action while its menu is open. Recover
    // focus only when that replacement dropped it onto the document body.
    const observer = new MutationObserver(() => {
      if (document.activeElement === document.body) {
        items()[0]?.focus({ preventScroll: true });
      }
    });
    observer.observe(menu, { childList: true, subtree: true });

    function restoreFocus() {
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        restoreFocus();
        close();
        return;
      }
      if (!menu?.contains(document.activeElement)) return;
      if (event.key === "Tab") {
        restoreFocus();
        close();
        return;
      }
      const buttons = items();
      const focused = document.activeElement;
      const index =
        focused instanceof HTMLButtonElement ? buttons.indexOf(focused) : -1;
      let next: number;
      switch (event.key) {
        case "ArrowDown":
          next = (index + 1) % buttons.length;
          break;
        case "ArrowUp":
          next = (index - 1 + buttons.length) % buttons.length;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = buttons.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      buttons[next]?.focus();
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown, true);
      if (
        menu.contains(document.activeElement) ||
        document.activeElement === document.body
      ) {
        restoreFocus();
      }
    };
  }, [menuRef, ready]);
}
