import { type ReactNode, type RefObject, useEffect, useRef } from "react";

export function ScreenshotsViewport({
  expanded,
  onCollapse,
  toggleRef,
  children,
}: {
  expanded: boolean;
  onCollapse: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wasExpanded = useRef(false);

  useEffect(() => {
    if (!expanded) {
      if (wasExpanded.current) {
        toggleRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    wasExpanded.current = true;
    dialogRef.current?.showModal();
    toggleRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded, toggleRef]);

  if (!expanded) {
    return children;
  }

  return (
    <dialog
      ref={dialogRef}
      className="screenshots-browser__viewport"
      aria-label="Screenshot viewer"
      onCancel={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onCollapse();
        }
      }}
      onClose={(event) => {
        // Closing the nested image lightbox should leave the gallery expanded.
        if (event.target === event.currentTarget) {
          onCollapse();
        }
      }}
    >
      {children}
    </dialog>
  );
}
