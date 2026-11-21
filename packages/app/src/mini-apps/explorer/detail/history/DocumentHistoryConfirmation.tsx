import { type FormEvent, useId, useRef } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  useModalEscapeAndFocusRestore,
} from "../../../../components/mini-app/MiniAppLayout";

/**
 * Asks before acting on the version on screen. Escape cancels, focus starts
 * on Cancel (the safe choice), and returns to the control that opened the
 * dialog when it closes.
 */
export function DocumentHistoryConfirmation(params: {
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const titleId = useId();
  const messageId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useModalEscapeAndFocusRestore(params.onCancel, cancelButtonRef);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    params.onConfirm();
  };

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>{params.title}</h2>
          <p id={messageId}>{params.message}</p>
          <MiniAppActions>
            <MiniAppButton
              onClick={params.onCancel}
              ref={cancelButtonRef}
              type="button"
            >
              {params.cancelLabel}
            </MiniAppButton>
            <MiniAppButton type="submit">{params.confirmLabel}</MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
