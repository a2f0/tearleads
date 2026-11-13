import { type ReactNode, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./screensaver.css";

export function ScreensaverOverlay({
  children,
  onStop,
  locked,
  interactive,
}: {
  children: ReactNode;
  onStop: () => void;
  locked: boolean;
  interactive: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      onStop();
    };
    const close = () => {
      if (!dialog.open) {
        onStop();
        if (locked) dialog.showModal();
      }
    };
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", close);
    dialog.showModal();
    dialog.focus();
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", close);
      dialog.close();
    };
  }, [onStop, locked]);
  return createPortal(
    <dialog
      aria-label="Screensaver"
      aria-description={
        interactive
          ? "Enter your PIN code to unlock, or cancel to return to the screensaver."
          : locked
            ? "Press Escape to enter your PIN."
            : "Press Escape to exit."
      }
      className={`screensaver-overlay${interactive ? " screensaver-overlay--unlock" : ""}`}
      ref={ref}
    >
      {interactive ? (
        children
      ) : (
        <div aria-hidden="true" inert className="screensaver-content">
          {children}
        </div>
      )}
    </dialog>,
    document.body,
  );
}
