import { type ReactNode, useId, useRef } from "react";
import { MiniAppButton } from "../controls/MiniAppButton";
import { MiniAppActions } from "../layout/MiniAppToolbar";
import { MiniAppModalBackdrop, MiniAppModalPanel } from "./MiniAppModal";
import { useModalEscapeAndFocusRestore } from "./useModalEscapeAndFocusRestore";
import "./MiniAppDetailModal.css";

const DETAIL_MODAL_CLOSE_LABEL = "Close";

/**
 * A read-only drill-down modal: a title over the caller's sections, then a
 * Close button. It closes on Escape, a tap on the backdrop, or Close, and
 * returns focus to whatever opened it. `actions` sit before Close.
 */
export function MiniAppDetailModal({
  actions,
  children,
  onClose,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useModalEscapeAndFocusRestore(onClose, closeButtonRef);

  return (
    <MiniAppModalBackdrop
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <MiniAppModalPanel
        aria-labelledby={titleId}
        aria-modal="true"
        className="mini-app-detail-modal-panel"
        role="dialog"
      >
        <h2 className="mini-app-detail-modal-title" id={titleId}>
          {title}
        </h2>
        {children}
        <MiniAppActions>
          {actions}
          <MiniAppButton onClick={onClose} ref={closeButtonRef}>
            {DETAIL_MODAL_CLOSE_LABEL}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
