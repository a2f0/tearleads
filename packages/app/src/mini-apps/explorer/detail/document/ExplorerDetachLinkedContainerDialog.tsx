import { type FormEvent, useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  EXPLORER_LABELS,
  getExplorerDetachLinkedContainerConfirmTitle,
} from "../../labels";

// Confirms detaching a document from one of its linked folders; the unlink
// only runs from the confirm button. The dialog stays open, busy, until the
// unlink settles so a second confirm cannot queue another one.
export function ExplorerDetachLinkedContainerDialog(params: {
  busy: boolean;
  containerLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!params.busy) {
      params.onConfirm();
    }
  };

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>
            {getExplorerDetachLinkedContainerConfirmTitle(
              params.containerLabel,
            )}
          </h2>
          <p id={messageId}>
            {EXPLORER_LABELS.linkedContainerDetachConfirmBody}
          </p>
          <MiniAppActions>
            <MiniAppButton
              disabled={params.busy}
              onClick={params.onCancel}
              type="button"
            >
              {EXPLORER_LABELS.linkedContainerDetachCancelAction}
            </MiniAppButton>
            <MiniAppButton disabled={params.busy} type="submit">
              {params.busy
                ? EXPLORER_LABELS.linkedContainerDetachingAction
                : EXPLORER_LABELS.linkedContainerDetachAction}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
