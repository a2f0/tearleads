import type { BlobBytes } from "@tearleads/client-sdk";
import type { NotesAttachFiles, NotesAttachmentUpload } from "../types";

async function readAttachmentUpload(
  file: File,
): Promise<NotesAttachmentUpload> {
  return {
    bytes: new Uint8Array(await file.arrayBuffer()) as BlobBytes,
    mimeType: file.type.length > 0 ? file.type : null,
    name: file.name,
  };
}

export function createNotesFileHandlers(input: {
  attachFiles: NotesAttachFiles;
}) {
  async function loadFiles(files: ReadonlyArray<File>) {
    input.attachFiles(await Promise.all(files.map(readAttachmentUpload)));
  }

  async function handleSelectedFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    await loadFiles(Array.from(fileList));
  }

  return {
    handleSelectedFiles,
  };
}
