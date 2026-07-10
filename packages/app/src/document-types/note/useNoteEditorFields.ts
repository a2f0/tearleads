import type {
  BlobStore,
  DocumentAttachment,
  DocumentAttachmentStatus,
  DocumentAttachmentUpload,
} from "@tearleads/client-sdk";
import {
  type DragEvent,
  type RefObject,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLog } from "../../providers/logging/LogProvider";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { downloadBytesAsFile } from "../../utils/downloadFile";
import { readDocumentAttachmentUpload } from "../shared/documentAttachmentUtils";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";

type NoteAttachmentStatusBySlotId = Readonly<
  Record<string, DocumentAttachmentStatus>
>;
type NoteAttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
type NoteAttachmentStorageKeyBySlotId = Readonly<Record<string, string>>;
type NoteDropzoneElement = HTMLFieldSetElement | HTMLLabelElement;

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
      const attachment = attachments.findLast(
        (candidate) => candidate.slotId === slotId,
      );
      const storageKey = attachmentStorageKeyBySlotId[slotId];
      if (!attachment || !storageKey) {
        return;
      }

      void blobStore
        .readBytes(storageKey)
        .then((bytes) => {
          if (!bytes) {
            logError(
              "Failed to download note attachment",
              new Error(`No local bytes for attachment ${attachment.name}.`),
            );
            return;
          }
          downloadBytesAsFile({
            bytes,
            fileName: attachment.name,
            mimeType: attachment.mimeType,
          });
        })
        .catch((error) => {
          logError("Failed to download note attachment", error);
        });
    },
    [attachments, attachmentStorageKeyBySlotId, blobStore, logError],
  );

  return {
    handleDownloadAttachment,
    handleRemoveAttachment,
    handleSelectedFiles,
  };
}

// Shared note editor data wiring: reads the documents store and exposes the
// editor text, attachment value maps, and drag/drop + file-input handlers that
// the presentational NoteEditorFields renders. Both the notes mini-app model
// and the explorer's note document renderer build on this so the editor and
// attachment behavior stay identical across the two surfaces.
export function useNoteEditorFields(): NoteEditorFieldsModel {
  const { infra } = useTearleadsRuntime();
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

  const dropzone = useNoteDropzone(canAttach, handleSelectedFiles);

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
