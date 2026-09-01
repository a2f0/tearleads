import type { DocumentContextValue } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import type { DocumentAttachmentSlots } from "./DocumentAttachmentSlots";
import type { DocumentAttachmentSlot } from "./documentAttachmentUtils";
import { useStructuredDocumentEditing } from "./StructuredDocument";
import { useAttachmentImageUrls } from "./useAttachmentImageUrls";
import { useBlobPickAttachment } from "./useBlobPickAttachment";
import { useDocumentAttachmentSelection } from "./useDocumentAttachmentSelection";

interface UseAttachedStructuredDocumentOptions<Fields> {
  readonly containerId: string | null;
  /** Lowercase label used in attachment error messages, e.g. "passport". */
  readonly documentLabel: string;
  readonly initialEditing?: boolean | undefined;
  readonly localId: string;
  readonly readFields: (source: Readonly<Record<string, unknown>>) => Fields;
  readonly slots: ReadonlyArray<DocumentAttachmentSlot>;
}

interface AttachedStructuredDocument<Fields> {
  readonly canWrite: boolean;
  readonly fields: Fields;
  readonly isEditing: boolean;
  readonly ready: boolean;
  readonly setStructuredFields: DocumentContextValue["setStructuredFields"];
  readonly slotsProps: Parameters<typeof DocumentAttachmentSlots>[0];
  readonly toggleEditing: () => void;
}

/**
 * The hook stack every attachment-slotted structured document (passport,
 * credit card, driver's license) shares: the document store, the typed-field
 * view, edit toggling, and the attachment plumbing for its slots.
 * `slotsProps` spreads straight into {@link DocumentAttachmentSlots}.
 */
export function useAttachedStructuredDocument<Fields>(
  options: UseAttachedStructuredDocumentOptions<Fields>,
): AttachedStructuredDocument<Fields> {
  const { infra } = useTearleadsRuntime();
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    canWrite,
    ready,
    removeAttachment,
    replaceAttachment,
    setStructuredFields,
    structuredFields,
  } = useDocument();
  const { readFields, slots } = options;
  const fields = useMemo(
    () => readFields(structuredFields),
    [readFields, structuredFields],
  );
  const [isEditing, , toggleEditing] = useStructuredDocumentEditing(
    canWrite,
    options.initialEditing,
  );
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    infra.blobStore,
  );
  const handleSelectedAttachment = useDocumentAttachmentSelection({
    errorMessage: `Failed to handle ${options.documentLabel} attachment selection`,
    replaceAttachment,
  });
  const slotIds = useMemo(() => slots.map((slot) => slot.slotId), [slots]);
  const blobPicker = useBlobPickAttachment({
    blobStore: infra.blobStore,
    containerId: options.containerId,
    errorMessage: `Failed to handle ${options.documentLabel} blob attachment selection`,
    localId: options.localId,
    replaceAttachment,
    slotIds,
  });

  return {
    canWrite,
    fields,
    isEditing,
    ready,
    setStructuredFields,
    slotsProps: {
      attachmentStorageKeyBySlotId,
      attachmentStatusBySlotId,
      attachments,
      blobPicker,
      canAttach: canAttach && isEditing && canWrite,
      imageUrlBySlotId,
      onClearAttachment: removeAttachment,
      onSelectedAttachment: handleSelectedAttachment,
      slots,
    },
    toggleEditing,
  };
}
