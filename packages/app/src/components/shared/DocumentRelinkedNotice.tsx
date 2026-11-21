import { MiniAppButton } from "../mini-app/controls/MiniAppButton";
import { MiniAppStatus } from "../mini-app/controls/MiniAppStatus";

export const DOCUMENT_RELINKED_LABELS = {
  message:
    "Another pane linked a different copy to this document. This view is read-only.",
  reopen: "Reopen",
} as const;

/**
 * Shown while an open document view stays on its own record after another
 * pane relinked a record onto the same document. Reopen shows the document's
 * current copy.
 */
export function DocumentRelinkedNotice(params: { onReopen: () => void }) {
  return (
    <MiniAppStatus className="document-relinked-notice" role="status">
      {DOCUMENT_RELINKED_LABELS.message}{" "}
      <MiniAppButton onClick={params.onReopen}>
        {DOCUMENT_RELINKED_LABELS.reopen}
      </MiniAppButton>
    </MiniAppStatus>
  );
}
