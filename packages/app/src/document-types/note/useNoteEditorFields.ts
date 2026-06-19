import type {
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
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";

type NoteAttachmentStatusBySlotId = Readonly<
  Record<string, DocumentAttachmentStatus>
>;
type NoteAttachmentImageUrlBySlotId = Readonly<Record<string, string>>;

interface NoteEditorFieldsModel {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: NoteAttachmentStatusBySlotId;
  canAttach: boolean;
  dragActive: boolean;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleDragEnter: (event: DragEvent<HTMLLabelElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLLabelElement>) => void;
  handleDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  handleDrop: (event: DragEvent<HTMLLabelElement>) => void;
  handleSelectedFiles: (fileList: FileList | null) => void;
  imageUrlBySlotId: NoteAttachmentImageUrlBySlotId;
  ready: boolean;
  setText: (text: string) => void;
  syncing: boolean;
  text: string;
}

async function readAttachmentUpload(
  file: File,
): Promise<DocumentAttachmentUpload> {
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type.length > 0 ? file.type : null,
    name: file.name,
  };
}

function useNoteDropzone(
  canAttach: boolean,
  handleSelectedFiles: (fileList: FileList | null) => void,
) {
  const [dragActive, setDragActive] = useState(false);

  const activateDropzone = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      if (!canAttach) {
        return;
      }

      event.preventDefault();
      setDragActive(true);
    },
    [canAttach],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
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
    ready,
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

  const handleSelectedFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) {
        return;
      }

      void Promise.all(Array.from(fileList).map(readAttachmentUpload))
        .then((uploads) => attachFiles(uploads))
        .catch((error) => {
          logError("Failed to attach note files", error);
        });
    },
    [attachFiles, logError],
  );

  const {
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  } = useNoteDropzone(canAttach, handleSelectedFiles);

  return useMemo(
    () => ({
      attachments,
      attachmentStatusBySlotId,
      canAttach,
      dragActive,
      fileInputId,
      fileInputRef,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      handleSelectedFiles,
      imageUrlBySlotId,
      ready,
      setText,
      syncing,
      text,
    }),
    [
      attachments,
      attachmentStatusBySlotId,
      canAttach,
      dragActive,
      fileInputId,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      handleSelectedFiles,
      imageUrlBySlotId,
      ready,
      setText,
      syncing,
      text,
    ],
  );
}
