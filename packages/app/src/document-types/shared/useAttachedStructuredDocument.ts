import type { DocumentContextValue } from "@tearleads/client-sdk";
import { useCallback, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import type { DocumentAttachmentSlots } from "./DocumentAttachmentSlots";
import {
  type DocumentAttachmentSlot,
  expandAttachmentSlots,
  resolveAttachmentUploadSlot,
} from "./documentAttachmentUtils";
import { useStructuredDocumentEditing } from "./StructuredDocument";
import { useAttachmentImageUrls } from "./useAttachmentImageUrls";
import { useBlobPickAttachment } from "./useBlobPickAttachment";
import { useDocumentAttachmentSelection } from "./useDocumentAttachmentSelection";

interface StructuredDocumentAttachmentOptions {
  readonly containerId: string | null;
  /** Lowercase label used in attachment error messages, e.g. "passport". */
  readonly documentLabel: string;
  readonly localId: string;
  readonly slots: ReadonlyArray<DocumentAttachmentSlot>;
}

interface UseAttachedStructuredDocumentOptions<Fields>
  extends StructuredDocumentAttachmentOptions {
  readonly initialEditing?: boolean | undefined;
  readonly readFields: (source: Readonly<Record<string, unknown>>) => Fields;
}

type DocumentAttachmentSlotsProps = Parameters<
  typeof DocumentAttachmentSlots
>[0];

interface AttachedStructuredDocument<Fields> {
  readonly canWrite: boolean;
  readonly fields: Fields;
  readonly isEditing: boolean;
  readonly ready: boolean;
  readonly setStructuredFields: DocumentContextValue["setStructuredFields"];
  readonly slotsProps: DocumentAttachmentSlotsProps;
  readonly toggleEditing: () => void;
}

/** Bind a blob picked in Explorer to the slot it was picked for. */
function useSlotBlobPicker(input: {
  blobStore: ReturnType<typeof useTearleadsRuntime>["infra"]["blobStore"];
  options: StructuredDocumentAttachmentOptions;
  ready: boolean;
  replaceAttachment: DocumentContextValue["replaceAttachment"];
  uploadSlots: ReadonlyArray<DocumentAttachmentSlot>;
}) {
  const { options, ready, replaceAttachment, uploadSlots } = input;
  const slotIds = useMemo(
    // A returned pick waits for hydrated attachments, which list each photo's
    // replace slot.
    () => (ready ? uploadSlots.map((slot) => slot.slotId) : []),
    [ready, uploadSlots],
  );
  const replacePickedAttachment = useCallback<
    DocumentContextValue["replaceAttachment"]
  >(
    (slotId, upload) =>
      replaceAttachment(
        resolveAttachmentUploadSlot(slotId, uploadSlots),
        upload,
      ),
    [replaceAttachment, uploadSlots],
  );
  return useBlobPickAttachment({
    blobStore: input.blobStore,
    containerId: options.containerId,
    errorMessage: `Failed to handle ${options.documentLabel} blob attachment selection`,
    localId: options.localId,
    replaceAttachment: replacePickedAttachment,
    slotIds,
  });
}

/**
 * The attachment plumbing for a structured document's slots, for a document
 * that owns its edit mode elsewhere (a vehicle shares its tracker's). Attaching
 * is offered only while editing a writable document.
 * The result spreads straight into {@link DocumentAttachmentSlots}.
 */
export function useStructuredDocumentAttachments(
  options: StructuredDocumentAttachmentOptions & {
    readonly isEditing: boolean;
  },
): DocumentAttachmentSlotsProps {
  const { infra, state } = useTearleadsRuntime();
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    canWrite,
    ready,
    removeAttachment,
    replaceAttachment,
    requestRemoteSync,
  } = useDocument();
  const { isEditing, slots } = options;
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    infra.blobStore,
  );
  const uploadSlots = useMemo(
    () =>
      expandAttachmentSlots(slots, attachments, {
        canAttach: true,
        isEditing: true,
      }),
    [slots, attachments],
  );
  const handleSelectedAttachment = useDocumentAttachmentSelection({
    errorMessage: `Failed to handle ${options.documentLabel} attachment selection`,
    replaceAttachment,
    slots: uploadSlots,
  });
  const blobPicker = useSlotBlobPicker({
    blobStore: infra.blobStore,
    options,
    ready,
    replaceAttachment,
    uploadSlots,
  });

  return {
    attachmentStorageKeyBySlotId,
    attachmentStatusBySlotId,
    attachments,
    blobPicker,
    canAttach: canAttach && isEditing && canWrite,
    imageUrlBySlotId,
    isEditing,
    onClearAttachment: removeAttachment,
    onRetryDownload: requestRemoteSync,
    onSelectedAttachment: handleSelectedAttachment,
    previewNotice: {
      blobStore: infra.blobStore,
      domainScope: state.domainScope,
    },
    slots,
  };
}

/**
 * The hook stack every attachment-slotted structured document (passport,
 * credit card, driver's license, tool, appliance, insurance policy) shares:
 * the document store, the typed-field view, edit toggling, and the attachment
 * plumbing for its slots.
 * `slotsProps` spreads straight into {@link DocumentAttachmentSlots}.
 */
export function useAttachedStructuredDocument<Fields>(
  options: UseAttachedStructuredDocumentOptions<Fields>,
): AttachedStructuredDocument<Fields> {
  const { canWrite, ready, setStructuredFields, structuredFields } =
    useDocument();
  const { readFields } = options;
  const fields = useMemo(
    () => readFields(structuredFields),
    [readFields, structuredFields],
  );
  const [isEditing, , toggleEditing] = useStructuredDocumentEditing(
    canWrite,
    options.initialEditing,
  );
  const slotsProps = useStructuredDocumentAttachments({
    ...options,
    isEditing,
  });

  return {
    canWrite,
    fields,
    isEditing,
    ready,
    setStructuredFields,
    slotsProps,
    toggleEditing,
  };
}
