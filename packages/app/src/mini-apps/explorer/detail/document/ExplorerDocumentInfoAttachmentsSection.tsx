import type { DocumentInfo } from "@symcrypt/client-sdk";
import {
  MiniAppButton,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/mini-app/MiniAppTable";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoAttachmentKindLabel,
} from "../../labels";
import { compactId } from "../compactId";

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

function getExplorerDocumentInfoAttachmentRows(input: {
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

export function ExplorerDocumentInfoAttachmentsSection(params: {
  documentInfo: DocumentInfo;
  openBlobBrowserRoute: OpenBlobBrowserRoute;
}) {
  const { attachments, remoteInfo } = params.documentInfo;
  const remoteBindings = remoteInfo?.activeAttachmentBindings ?? [];
  const { localRows, remoteRows } = getExplorerDocumentInfoAttachmentRows({
    attachments,
    remoteBindings,
  });
  const hasRows = localRows.length > 0 || remoteRows.length > 0;

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoAttachmentsHeading}
    >
      {!hasRows ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoAttachments}
        </MiniAppStatus>
      ) : (
        <MiniAppInfoTable>
          <thead>
            <tr>
              <th>{EXPLORER_LABELS.documentInfoAttachmentKindColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentSlotColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentBlobColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentNameColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentSizeColumn}</th>
              <th>{EXPLORER_LABELS.documentInfoAttachmentTimeColumn}</th>
            </tr>
          </thead>
          <tbody>
            {localRows.map((row) => {
              const { attachment, remoteBinding } = row;
              const time = attachment.createdAt ?? attachment.updatedAt;
              return (
                <tr
                  key={`${row.state}:${attachment.slotId}:${attachment.blobId ?? ""}:${attachment.storageKey}`}
                >
                  <td title={remoteBinding?.bindingId ?? undefined}>
                    {getExplorerDocumentInfoAttachmentKindLabel(row.state)}
                  </td>
                  <td title={attachment.slotId}>
                    {compactId(attachment.slotId)}
                  </td>
                  <td title={attachment.blobId ?? undefined}>
                    <MiniAppButton
                      disabled={!attachment.blobId && !attachment.storageKey}
                      variant="ghost"
                      onClick={() => {
                        params.openBlobBrowserRoute({
                          blobId: attachment.blobId,
                          storageKey: attachment.storageKey,
                        });
                      }}
                    >
                      {compactId(attachment.blobId ?? attachment.storageKey)}
                    </MiniAppButton>
                  </td>
                  <td
                    title={
                      remoteBinding
                        ? `${attachment.storageKey} ${remoteBinding.bindingId}`
                        : attachment.storageKey
                    }
                  >
                    {attachment.name ?? attachment.mimeType ?? "-"}
                  </td>
                  <td>{formatByteLength(attachment.byteLength)}</td>
                  <td title={time ?? undefined}>
                    {formatMiniAppDateTime(time, { emptyFallback: "-" })}
                  </td>
                </tr>
              );
            })}
            {remoteRows.map(({ binding, state }) => (
              <tr key={`remote:${binding.bindingId}`}>
                <td>{getExplorerDocumentInfoAttachmentKindLabel(state)}</td>
                <td title={binding.slotId}>{compactId(binding.slotId)}</td>
                <td title={binding.blobId}>
                  <MiniAppButton
                    variant="ghost"
                    onClick={() => {
                      params.openBlobBrowserRoute({ blobId: binding.blobId });
                    }}
                  >
                    {compactId(binding.blobId)}
                  </MiniAppButton>
                </td>
                <td title={binding.bindingId}>
                  {compactId(binding.bindingId)}
                </td>
                <td>-</td>
                <td>-</td>
              </tr>
            ))}
          </tbody>
        </MiniAppInfoTable>
      )}
    </MiniAppInfoSection>
  );
}
