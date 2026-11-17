import type { DocumentInfo } from "@tearleads/client-sdk";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoAttachmentKindLabel,
} from "../../labels";
import { compactId } from "../compactId";
import {
  type ExplorerInfoRowDetail,
  formatExplorerInfoRowDetailTime,
} from "../row-detail/ExplorerInfoRowDetail";

export type OpenBlobBrowserRoute = (input?: {
  blobId?: string | null | undefined;
  storageKey?: string | null | undefined;
}) => void;

type DocumentInfoAttachment = DocumentInfo["attachments"][number];
type DocumentInfoRemoteAttachmentBinding = NonNullable<
  DocumentInfo["remoteInfo"]
>["activeAttachmentBindings"][number];

interface LocalDocumentInfoAttachmentRow {
  attachment: DocumentInfoAttachment;
  remoteBinding: DocumentInfoRemoteAttachmentBinding | null;
  state: "local" | "local-remote" | "pending";
}

interface RemoteDocumentInfoAttachmentRow {
  binding: DocumentInfoRemoteAttachmentBinding;
  state: "remote";
}

function getAttachmentRemoteBindingKey(input: {
  blobId: string | null;
  slotId: string;
}): string | null {
  return input.blobId ? `${input.slotId}\u0000${input.blobId}` : null;
}

export function getExplorerDocumentInfoAttachmentRows(input: {
  attachments: ReadonlyArray<DocumentInfoAttachment>;
  remoteBindings: ReadonlyArray<DocumentInfoRemoteAttachmentBinding>;
}): {
  localRows: LocalDocumentInfoAttachmentRow[];
  remoteRows: RemoteDocumentInfoAttachmentRow[];
} {
  const matchedRemoteBindingIds = new Set<string>();
  const remoteBindingsByKey = new Map<
    string,
    DocumentInfoRemoteAttachmentBinding[]
  >();

  for (const binding of input.remoteBindings) {
    const key = getAttachmentRemoteBindingKey(binding);
    if (key) {
      const bindings = remoteBindingsByKey.get(key);
      if (bindings) {
        bindings.push(binding);
      } else {
        remoteBindingsByKey.set(key, [binding]);
      }
    }
  }

  const localRows = input.attachments.map(
    (attachment): LocalDocumentInfoAttachmentRow => {
      const key =
        attachment.attachmentKind === "local"
          ? getAttachmentRemoteBindingKey(attachment)
          : null;
      const bindings = key ? remoteBindingsByKey.get(key) : null;
      const remoteBinding = bindings?.shift() ?? null;
      if (remoteBinding) {
        matchedRemoteBindingIds.add(remoteBinding.bindingId);
      }

      return {
        attachment,
        remoteBinding,
        state: remoteBinding ? "local-remote" : attachment.attachmentKind,
      };
    },
  );

  return {
    localRows,
    remoteRows: input.remoteBindings
      .filter((binding) => !matchedRemoteBindingIds.has(binding.bindingId))
      .map((binding) => ({ binding, state: "remote" })),
  };
}

/** One attachment row as shown, whichever side (local or remote) it came from. */
export interface AttachmentDisplayRow {
  bindingId: string | null;
  blob: {
    disabled: boolean;
    label: string;
    open: () => void;
    title?: string | undefined;
  };
  key: string;
  kind: { text: string; title?: string | undefined };
  name: { text: string; title: string };
  size: string;
  slot: { text: string; title: string };
  storageKey: string | null;
  time: { text: string; title?: string | undefined };
}

export function getLocalAttachmentDisplayRow(
  row: LocalDocumentInfoAttachmentRow,
  openBlobBrowserRoute: OpenBlobBrowserRoute,
): AttachmentDisplayRow {
  const { attachment, remoteBinding } = row;
  const time = attachment.createdAt ?? attachment.updatedAt;
  return {
    bindingId: remoteBinding?.bindingId ?? null,
    blob: {
      disabled: !attachment.blobId && !attachment.storageKey,
      label: compactId(attachment.blobId ?? attachment.storageKey),
      open: () =>
        openBlobBrowserRoute({
          blobId: attachment.blobId,
          storageKey: attachment.storageKey,
        }),
      title: attachment.blobId ?? undefined,
    },
    key: `${row.state}:${attachment.slotId}:${attachment.blobId ?? ""}:${attachment.storageKey}`,
    kind: {
      text: getExplorerDocumentInfoAttachmentKindLabel(row.state),
      title: remoteBinding?.bindingId ?? undefined,
    },
    name: {
      text: attachment.name ?? attachment.mimeType ?? "-",
      title: remoteBinding
        ? `${attachment.storageKey} ${remoteBinding.bindingId}`
        : attachment.storageKey,
    },
    size: formatByteLength(attachment.byteLength),
    slot: { text: compactId(attachment.slotId), title: attachment.slotId },
    storageKey: attachment.storageKey,
    time: {
      text: formatMiniAppDateTime(time, { emptyFallback: "-" }),
      title: time ?? undefined,
    },
  };
}

export function getRemoteAttachmentDisplayRow(
  row: RemoteDocumentInfoAttachmentRow,
  openBlobBrowserRoute: OpenBlobBrowserRoute,
): AttachmentDisplayRow {
  const { binding } = row;
  return {
    bindingId: binding.bindingId,
    blob: {
      disabled: false,
      label: compactId(binding.blobId),
      open: () => openBlobBrowserRoute({ blobId: binding.blobId }),
      title: binding.blobId,
    },
    key: `remote:${binding.bindingId}`,
    kind: { text: getExplorerDocumentInfoAttachmentKindLabel(row.state) },
    name: { text: compactId(binding.bindingId), title: binding.bindingId },
    size: "-",
    slot: { text: compactId(binding.slotId), title: binding.slotId },
    storageKey: null,
    time: { text: "-" },
  };
}

export function getAttachmentDetail(
  row: AttachmentDisplayRow,
): ExplorerInfoRowDetail {
  return {
    // Folded there is no Blob column, so the detail carries the same
    // open-in-blob-browser action the unfolded Blob button does.
    action: row.blob.disabled
      ? undefined
      : {
          label: EXPLORER_LABELS.infoRowDetailOpenBlobAction,
          run: row.blob.open,
        },
    fields: [
      {
        id: "name",
        label: EXPLORER_LABELS.documentInfoAttachmentNameColumn,
        value: row.name.text,
      },
      {
        id: "kind",
        label: EXPLORER_LABELS.documentInfoAttachmentKindColumn,
        value: row.kind.text,
      },
      {
        copyable: true,
        id: "slot",
        label: EXPLORER_LABELS.documentInfoAttachmentSlotColumn,
        value: row.slot.title,
      },
      {
        copyable: true,
        id: "blob",
        label: EXPLORER_LABELS.documentInfoAttachmentBlobColumn,
        value: row.blob.title,
      },
      {
        copyable: true,
        id: "storageKey",
        label: EXPLORER_LABELS.infoRowDetailStorageKeyRow,
        value: row.storageKey,
      },
      {
        copyable: true,
        id: "binding",
        label: EXPLORER_LABELS.infoRowDetailBindingRow,
        value: row.bindingId,
      },
      {
        id: "size",
        label: EXPLORER_LABELS.documentInfoAttachmentSizeColumn,
        value: row.size,
      },
      {
        id: "time",
        label: EXPLORER_LABELS.documentInfoAttachmentTimeColumn,
        value: formatExplorerInfoRowDetailTime(row.time.title),
      },
    ],
    title: EXPLORER_LABELS.infoRowDetailAttachmentTitle,
  };
}
