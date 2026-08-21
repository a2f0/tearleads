import type { DocumentAttachment } from "@symcrypt/client-sdk";
import { type FormEvent, useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
} from "../../components/mini-app/MiniAppLayout";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";

// Confirms removal of a single note attachment before the destructive store op
// runs. The caller renders this only while a removal is pending, so `attachment`
// is always present. Removing an attachment is a local CRDT edit with no async
// round-trip, so there is no busy/pending state to guard here.
export function RemoveAttachmentConfirmationDialog({
  attachment,
  onCancel,
  onConfirm,
}: {
  attachment: DocumentAttachment;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConfirm();
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
            {NOTE_DOCUMENT_LABELS.removeAttachmentConfirmTitle}
          </h2>
          <p id={messageId}>
            {NOTE_DOCUMENT_LABELS.removeAttachmentConfirmMessage(
              attachment.name,
            )}
          </p>
          <MiniAppActions>
            <MiniAppButton onClick={onCancel} type="button">
              {NOTE_DOCUMENT_LABELS.removeAttachmentConfirmCancel}
            </MiniAppButton>
            <MiniAppButton type="submit">
              {NOTE_DOCUMENT_LABELS.removeAttachmentConfirmConfirm}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
