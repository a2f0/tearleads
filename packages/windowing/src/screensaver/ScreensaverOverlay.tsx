import { type ReactNode, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./screensaver.css";

export function ScreensaverOverlay({
  children,
  onStop,
}: {
  children: ReactNode;
  onStop: () => void;
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
      if (!dialog.open) onStop();
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
  }, [onStop]);
  return createPortal(
    <dialog
      aria-label="Screensaver"
      aria-description="Press Escape to exit."
      className="screensaver-overlay"
      ref={ref}
    >
      <div aria-hidden="true" inert className="screensaver-content">
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
