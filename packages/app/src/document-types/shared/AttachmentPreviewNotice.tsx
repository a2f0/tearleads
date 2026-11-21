import {
  type BlobStore,
  type DomainScope,
  hasPendingLocalDocumentWrites,
} from "@tearleads/client-sdk";
import { useState } from "react";
import { MiniAppButton } from "../../components/mini-app/controls/MiniAppButton";
import { MiniAppStatus } from "../../components/mini-app/controls/MiniAppStatus";
import { retryFailedPreviewReads } from "./attachmentPreviewReads";
import { usePreviewReadHealth } from "./useAttachmentImageUrls";

export const ATTACHMENT_PREVIEW_NOTICE_LABELS = {
  failed: "Some image previews couldn't be read.",
  reload: "Reload",
  reloading: "Saving changes...",
  retry: "Retry",
  stalled:
    "Local storage isn't responding, so some image previews can't load. Reload to reconnect; your changes are saved first.",
} as const;

const SAVE_POLL_MS = 100;
const SAVE_WAIT_MS = 10_000;

/**
 * Reload the page once open documents have written their edits to SQLite.
 * A read stuck in the browser's file system cannot be cancelled, and only a
 * reload releases it. If edits are still queued when the wait ends, the
 * page's before-unload guard asks before discarding them.
 */
export async function reloadAfterSavingDocuments(
  domainScope: DomainScope,
  reload: () => void = () => window.location.reload(),
  hasPendingWrites: (
    scope: DomainScope,
  ) => boolean = hasPendingLocalDocumentWrites,
): Promise<void> {
  const deadline = Date.now() + SAVE_WAIT_MS;
  while (hasPendingWrites(domainScope) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SAVE_POLL_MS));
  }
  reload();
}

/** What a gallery needs to report unresponsive or unreadable previews. */
export interface AttachmentPreviewNoticeSource {
  readonly blobStore: BlobStore;
  readonly domainScope: DomainScope;
}

export function AttachmentPreviewNotice(params: AttachmentPreviewNoticeSource) {
  const { blobStore, domainScope } = params;
  const health = usePreviewReadHealth(blobStore);
  const [reloading, setReloading] = useState(false);
  if (health.stalledReads > 0) {
    return (
      <MiniAppStatus className="attachment-preview-notice" role="status">
        {ATTACHMENT_PREVIEW_NOTICE_LABELS.stalled}{" "}
        <MiniAppButton
          disabled={reloading}
          onClick={() => {
            setReloading(true);
            void reloadAfterSavingDocuments(domainScope);
          }}
        >
          {reloading
            ? ATTACHMENT_PREVIEW_NOTICE_LABELS.reloading
            : ATTACHMENT_PREVIEW_NOTICE_LABELS.reload}
        </MiniAppButton>
      </MiniAppStatus>
    );
  }
  if (health.failedReads > 0) {
    return (
      <MiniAppStatus className="attachment-preview-notice" role="status">
        {ATTACHMENT_PREVIEW_NOTICE_LABELS.failed}{" "}
        <MiniAppButton onClick={() => retryFailedPreviewReads(blobStore)}>
          {ATTACHMENT_PREVIEW_NOTICE_LABELS.retry}
        </MiniAppButton>
      </MiniAppStatus>
    );
  }
  return null;
}
