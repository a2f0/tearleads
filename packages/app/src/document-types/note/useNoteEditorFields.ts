import type {
  BlobStore,
  DocumentAttachment,
  DocumentAttachmentStatus,
  DocumentAttachmentUpload,
} from "@symcrypt/client-sdk";
import {
  type DragEvent,
  type RefObject,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFileSaver } from "../../providers/file-saver/FileSaverProvider";
import { useLog } from "../../providers/logging/LogProvider";
import { useSymCryptRuntime } from "../../providers/sdk/SymCryptProvider";
import {
  DEFAULT_DOCUMENT_ID,
  useDocument,
} from "../../stores/documents/DocumentsProvider";
import { downloadBytesAsFile } from "../../utils/downloadFile";
import {
  type DocumentAttachmentSlot,
  readDocumentAttachmentUpload,
} from "../shared/documentAttachmentUtils";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";
import { useBlobPickAttachment } from "../shared/useBlobPickAttachment";

type NoteAttachmentStatusBySlotId = Readonly<
  Record<string, DocumentAttachmentStatus>
>;
type NoteAttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
type NoteAttachmentStorageKeyBySlotId = Readonly<Record<string, string>>;
type NoteDropzoneElement = HTMLFieldSetElement | HTMLLabelElement;

// A note holds many free-form attachments (unlike the fixed front/back slots of
// a structured document), so blob picking routes through a single opaque slot
// and the chosen blob is appended as a fresh attachment rather than bound to a
// named slot. The slot is only a routing channel for the host's blob picker;
// the appended attachment gets its own generated slot id.
const NOTE_BLOB_PICK_SLOT: DocumentAttachmentSlot = {
  label: "Attachment",
  slotId: "note-attachment-blob-pick",
};
const NOTE_BLOB_PICK_SLOT_IDS: ReadonlyArray<string> = [
  NOTE_BLOB_PICK_SLOT.slotId,
];

interface NoteEditorFieldsModel {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: NoteAttachmentStatusBySlotId;
  attachmentStorageKeyBySlotId: NoteAttachmentStorageKeyBySlotId;
  canAttach: boolean;
  dragActive: boolean;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleDownloadAttachment: (slotId: string) => void;
  handleDragEnter: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDragLeave: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDragOver: (event: DragEvent<NoteDropzoneElement>) => void;
  handleDrop: (event: DragEvent<NoteDropzoneElement>) => void;
  handleRemoveAttachment: (slotId: string) => void;
  // Opens the host's blob picker to attach an existing blob. `undefined` when no
  // blob picker is available (no host mounted, or the container has no blobs) so
  // the "Select Blob" control stays hidden — mirrors the structured-document
  // "Choose Blob" affordance.
  handleSelectBlob: (() => void) | undefined;
  handleSelectedFiles: (fileList: FileList | null) => void;
  imageUrlBySlotId: NoteAttachmentImageUrlBySlotId;
  ready: boolean;
  readOnly: boolean;
  setText: (text: string) => void;
  syncing: boolean;
  text: string;
}

function useNoteDropzone(
  canAttach: boolean,
  handleSelectedFiles: (fileList: FileList | null) => void,
) {
  const [dragActive, setDragActive] = useState(false);

  const activateDropzone = useCallback(
    (event: DragEvent<NoteDropzoneElement>) => {
      if (!canAttach) {
        return;
      }

      event.preventDefault();
      setDragActive(true);
    },
    [canAttach],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent<NoteDropzoneElement>) => {
      event.preventDefault();
      setDragActive(false);
    },
    [],
  );

  const handleDrop = useCallback(
    (event: DragEvent<NoteDropzoneElement>) => {
      event.preventDefault();
      setDragActive(false);
      if (!canAttach) {
        return;
      }

      handleSelectedFiles(event.dataTransfer.files);
    },
    [canAttach, handleSelectedFiles],
  );

  return {
    dragActive,
    handleDragEnter: activateDropzone,
    handleDragLeave,
    handleDragOver: activateDropzone,
    handleDrop,
  };
}

function useNoteAttachmentActions({
  attachFiles,
  attachments,
  attachmentStorageKeyBySlotId,
  blobStore,
  logError,
  removeAttachment,
}: {
  attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => void;
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStorageKeyBySlotId: NoteAttachmentStorageKeyBySlotId;
  blobStore: BlobStore;
  logError: (message: string, error: unknown) => void;
  removeAttachment: (slotId: string) => void;
}) {
  const fileSaver = useFileSaver();
  const handleSelectedFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) {
        return;
      }

      void Promise.all(Array.from(fileList).map(readDocumentAttachmentUpload))
        .then((uploads) => attachFiles(uploads))
        .catch((error) => {
          logError("Failed to attach note files", error);
        });
    },
    [attachFiles, logError],
  );
  const handleRemoveAttachment = useCallback(
    (slotId: string) => {
      removeAttachment(slotId);
    },
    [removeAttachment],
  );
  // Save an attachment's bytes to disk. Reads from the local blob store by the
  // slot's storage key, so it works the same in the standalone notes app and
  // the explorer's inline note without depending on the explorer's blob
  // browser. A slot with no local bytes yet (never happens once attached, but
  // guards the pending window) is silently a no-op besides a logged error.
  const handleDownloadAttachment = useCallback(
    (slotId: string) => {
      const attachment = attachments.find(
        (candidate) => candidate.slotId === slotId,
      );
      const storageKey = attachmentStorageKeyBySlotId[slotId];
      if (!attachment || !storageKey) {
        return;
      }

      void blobStore
        .readBytes(storageKey)
        .then(async (bytes) => {
          if (!bytes) {
            logError(
              "Failed to download note attachment",
              new Error(`No local bytes for attachment ${attachment.name}.`),
            );
            return;
          }
          await downloadBytesAsFile(fileSaver, {
            bytes,
            fileName: attachment.name,
            mimeType: attachment.mimeType,
          });
        })
        .catch((error) => {
          logError("Failed to download note attachment", error);
        });
    },
    [attachments, attachmentStorageKeyBySlotId, blobStore, fileSaver, logError],
  );

  return {
    handleDownloadAttachment,
    handleRemoveAttachment,
    handleSelectedFiles,
  };
}

// Bridges the note to the host's blob picker so an existing blob can be
// attached, reusing the same `useBlobPickAttachment` seam the structured
// document slots use — which already hides the affordance when no host is
// mounted or the container is empty. The note has no fixed slots, so the picked
// blob is appended as a new attachment (via attachFiles) rather than bound to a
// slot; the routing slot id is inert. Returns `undefined` when picking is
// unavailable so the "Select Blob" button stays hidden.
function useNoteBlobPickAttachment(params: {
  attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => void;
  blobStore: BlobStore;
  containerId: string | null;
  localId: string;
}): (() => void) | undefined {
  const { attachFiles, blobStore, containerId, localId } = params;
  const appendPickedBlob = useCallback(
    (_slotId: string, attachment: DocumentAttachmentUpload) => {
      attachFiles([attachment]);
    },
    [attachFiles],
  );
  const blobPicker = useBlobPickAttachment({
    blobStore,
    containerId,
    errorMessage: "Failed to handle note blob attachment selection",
    localId,
    replaceAttachment: appendPickedBlob,
    slotIds: NOTE_BLOB_PICK_SLOT_IDS,
  });

  const onRequestBlobPick = blobPicker?.onRequestBlobPick;
  return useMemo(
    () =>
      onRequestBlobPick
        ? () => onRequestBlobPick(NOTE_BLOB_PICK_SLOT)
        : undefined,
    [onRequestBlobPick],
  );
}

// Shared note editor data wiring: reads the documents store and exposes the
// editor text, attachment value maps, and drag/drop + file-input handlers that
// the presentational NoteEditorFields renders. Both the notes mini-app model
// and the explorer's note document renderer build on this so the editor and
// attachment behavior stay identical across the two surfaces. The optional
// container/local ids let the explorer surface wire the blob picker; the
// standalone mini-app omits them and the "Select Blob" control stays hidden.
export function useNoteEditorFields(
  params: { containerId?: string | null; localId?: string | undefined } = {},
): NoteEditorFieldsModel {
  const { containerId = null, localId = DEFAULT_DOCUMENT_ID } = params;
  const { infra } = useSymCryptRuntime();
  const { blobStore } = infra;
  const { logError } = useLog();
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    attachFiles,
    canAttach,
    canWrite,
    ready,
    removeAttachment,
    setText,
    syncing,
    text,
  } = useDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );
  const {
    handleDownloadAttachment,
    handleRemoveAttachment,
    handleSelectedFiles,
  } = useNoteAttachmentActions({
    attachFiles,
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
    logError,
    removeAttachment,
  });
  const handleSelectBlob = useNoteBlobPickAttachment({
    attachFiles,
    blobStore,
    containerId,
    localId,
  });

  // `canAttach` already implies write access (the store derives it from
  // canWriteDocument), but gate the drop surface on `canWrite` explicitly too so
  // a read-only note never accepts a drag-and-drop upload even if that invariant
  // is ever relaxed upstream.
  const dropzone = useNoteDropzone(canAttach && canWrite, handleSelectedFiles);

  return useNoteEditorFieldsModel({
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    canWrite,
    dropzone,
    fileInputId,
    fileInputRef,
    handleDownloadAttachment,
    handleRemoveAttachment,
    // A read-only note can't attach, so suppress the blob picker even if a host
    // is mounted with pickable blobs — keeps "Select Blob" in lockstep with the
    // upload control's interactivity gate.
    handleSelectBlob: canAttach && canWrite ? handleSelectBlob : undefined,
    handleSelectedFiles,
    imageUrlBySlotId,
    ready,
    setText,
    syncing,
    text,
  });
}

// Assemble the memoized model the presentational NoteEditorFields consumes.
// Split out from useNoteEditorFields so the wiring above stays focused on
// reading the store and composing the action/dropzone hooks. The dropzone
// handlers are stable useCallback identities, so depending on the `dropzone`
// object (a fresh literal each render) would defeat the memo; we spread its
// fields and depend on each handler individually to keep the model identity
// stable across renders.
function useNoteEditorFieldsModel(input: {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: NoteAttachmentStatusBySlotId;
  attachmentStorageKeyBySlotId: NoteAttachmentStorageKeyBySlotId;
  canAttach: boolean;
  canWrite: boolean;
  dropzone: ReturnType<typeof useNoteDropzone>;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleDownloadAttachment: (slotId: string) => void;
  handleRemoveAttachment: (slotId: string) => void;
  handleSelectBlob: (() => void) | undefined;
  handleSelectedFiles: (fileList: FileList | null) => void;
  imageUrlBySlotId: NoteAttachmentImageUrlBySlotId;
  ready: boolean;
  setText: (text: string) => void;
  syncing: boolean;
  text: string;
}): NoteEditorFieldsModel {
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    canWrite,
    dropzone,
    fileInputId,
    fileInputRef,
    handleDownloadAttachment,
    handleRemoveAttachment,
    handleSelectBlob,
    handleSelectedFiles,
    imageUrlBySlotId,
    ready,
    setText,
    syncing,
    text,
  } = input;
  const {
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  } = dropzone;

  return useMemo(
    () => ({
      attachments,
      attachmentStatusBySlotId,
      attachmentStorageKeyBySlotId,
      canAttach,
      dragActive,
      fileInputId,
      fileInputRef,
      handleDownloadAttachment,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      handleRemoveAttachment,
      handleSelectBlob,
      handleSelectedFiles,
      imageUrlBySlotId,
      ready,
      readOnly: !canWrite,
      setText,
      syncing,
      text,
    }),
    [
      attachments,
      attachmentStatusBySlotId,
      attachmentStorageKeyBySlotId,
      canAttach,
      dragActive,
      fileInputId,
      fileInputRef,
      handleDownloadAttachment,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      handleRemoveAttachment,
      handleSelectBlob,
      handleSelectedFiles,
      imageUrlBySlotId,
      ready,
      canWrite,
      setText,
      syncing,
      text,
    ],
  );
}
