import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { FileArchiveIcon } from "@phosphor-icons/react/dist/csr/FileArchive";
import { FileAudioIcon } from "@phosphor-icons/react/dist/csr/FileAudio";
import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import { FileCsvIcon } from "@phosphor-icons/react/dist/csr/FileCsv";
import { FileDocIcon } from "@phosphor-icons/react/dist/csr/FileDoc";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { FilePptIcon } from "@phosphor-icons/react/dist/csr/FilePpt";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { FileVideoIcon } from "@phosphor-icons/react/dist/csr/FileVideo";
import { FileXlsIcon } from "@phosphor-icons/react/dist/csr/FileXls";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import type { Icon } from "@phosphor-icons/react/dist/lib/types";

// A small taxonomy for how a note attachment is presented: the tile/preview
// icon plus a short human "kind" label (e.g. "PDF", "Image", "Audio"). Both the
// compact tiles and the enlarged preview overlay read from this so the visual
// language for a file type stays consistent between the two surfaces.
interface AttachmentFileType {
  Icon: Icon;
  // Short, uppercase-friendly kind shown on the tile (e.g. "PDF", "IMAGE").
  kind: string;
  // Whether this type renders as an inline image thumbnail/preview.
  isImage: boolean;
}

const GENERIC_FILE_TYPE: AttachmentFileType = {
  Icon: FileIcon,
  kind: "File",
  isImage: false,
};

// MIME-prefix and exact-MIME rules, checked before falling back to the file
// extension. Prefix rules cover the open-ended families (every image/*, audio/*
// and video/* subtype) while the exact map pins the document formats whose MIME
// types are stable and well-known.
const MIME_EXACT: ReadonlyMap<string, AttachmentFileType> = new Map([
  ["application/pdf", { Icon: FilePdfIcon, kind: "PDF", isImage: false }],
  [
    "application/zip",
    { Icon: FileArchiveIcon, kind: "Archive", isImage: false },
  ],
  [
    "application/x-zip-compressed",
    { Icon: FileArchiveIcon, kind: "Archive", isImage: false },
  ],
  [
    "application/gzip",
    { Icon: FileArchiveIcon, kind: "Archive", isImage: false },
  ],
  [
    "application/x-tar",
    { Icon: FileArchiveIcon, kind: "Archive", isImage: false },
  ],
  [
    "application/x-7z-compressed",
    { Icon: FileArchiveIcon, kind: "Archive", isImage: false },
  ],
  ["text/csv", { Icon: FileCsvIcon, kind: "CSV", isImage: false }],
  ["application/json", { Icon: FileCodeIcon, kind: "Code", isImage: false }],
  ["application/msword", { Icon: FileDocIcon, kind: "Doc", isImage: false }],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    { Icon: FileDocIcon, kind: "Doc", isImage: false },
  ],
  [
    "application/vnd.ms-excel",
    { Icon: FileXlsIcon, kind: "Sheet", isImage: false },
  ],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    { Icon: FileXlsIcon, kind: "Sheet", isImage: false },
  ],
  [
    "application/vnd.ms-powerpoint",
    { Icon: FilePptIcon, kind: "Slides", isImage: false },
  ],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    { Icon: FilePptIcon, kind: "Slides", isImage: false },
  ],
]);

// Extension fallbacks for files whose upload carried no (or a generic) MIME
// type — common when dropping files from a native file manager.
const EXTENSION_MAP: ReadonlyMap<string, AttachmentFileType> = new Map([
  ["pdf", { Icon: FilePdfIcon, kind: "PDF", isImage: false }],
  ["zip", { Icon: FileArchiveIcon, kind: "Archive", isImage: false }],
  ["gz", { Icon: FileArchiveIcon, kind: "Archive", isImage: false }],
  ["tar", { Icon: FileArchiveIcon, kind: "Archive", isImage: false }],
  ["tgz", { Icon: FileArchiveIcon, kind: "Archive", isImage: false }],
  ["rar", { Icon: FileArchiveIcon, kind: "Archive", isImage: false }],
  ["7z", { Icon: FileArchiveIcon, kind: "Archive", isImage: false }],
  ["csv", { Icon: FileCsvIcon, kind: "CSV", isImage: false }],
  ["doc", { Icon: FileDocIcon, kind: "Doc", isImage: false }],
  ["docx", { Icon: FileDocIcon, kind: "Doc", isImage: false }],
  ["rtf", { Icon: FileDocIcon, kind: "Doc", isImage: false }],
  ["xls", { Icon: FileXlsIcon, kind: "Sheet", isImage: false }],
  ["xlsx", { Icon: FileXlsIcon, kind: "Sheet", isImage: false }],
  ["ppt", { Icon: FilePptIcon, kind: "Slides", isImage: false }],
  ["pptx", { Icon: FilePptIcon, kind: "Slides", isImage: false }],
  ["txt", { Icon: FileTextIcon, kind: "Text", isImage: false }],
  ["md", { Icon: FileTextIcon, kind: "Text", isImage: false }],
  ["json", { Icon: FileCodeIcon, kind: "Code", isImage: false }],
  ["js", { Icon: FileCodeIcon, kind: "Code", isImage: false }],
  ["ts", { Icon: FileCodeIcon, kind: "Code", isImage: false }],
  ["tsx", { Icon: FileCodeIcon, kind: "Code", isImage: false }],
  ["css", { Icon: FileCodeIcon, kind: "Code", isImage: false }],
  ["html", { Icon: FileCodeIcon, kind: "Code", isImage: false }],
  ["py", { Icon: FileCodeIcon, kind: "Code", isImage: false }],
  ["sh", { Icon: FileCodeIcon, kind: "Code", isImage: false }],
  ["png", { Icon: ImageIcon, kind: "Image", isImage: true }],
  ["jpg", { Icon: ImageIcon, kind: "Image", isImage: true }],
  ["jpeg", { Icon: ImageIcon, kind: "Image", isImage: true }],
  ["gif", { Icon: ImageIcon, kind: "Image", isImage: true }],
  ["webp", { Icon: ImageIcon, kind: "Image", isImage: true }],
  ["svg", { Icon: ImageIcon, kind: "Image", isImage: true }],
  ["bmp", { Icon: ImageIcon, kind: "Image", isImage: true }],
  ["mp3", { Icon: FileAudioIcon, kind: "Audio", isImage: false }],
  ["wav", { Icon: FileAudioIcon, kind: "Audio", isImage: false }],
  ["m4a", { Icon: FileAudioIcon, kind: "Audio", isImage: false }],
  ["ogg", { Icon: FileAudioIcon, kind: "Audio", isImage: false }],
  ["flac", { Icon: FileAudioIcon, kind: "Audio", isImage: false }],
  ["mp4", { Icon: FileVideoIcon, kind: "Video", isImage: false }],
  ["mov", { Icon: FileVideoIcon, kind: "Video", isImage: false }],
  ["webm", { Icon: FileVideoIcon, kind: "Video", isImage: false }],
  ["mkv", { Icon: FileVideoIcon, kind: "Video", isImage: false }],
  ["avi", { Icon: FileVideoIcon, kind: "Video", isImage: false }],
]);

function getFileExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  return name.slice(dot + 1).toLowerCase();
}

// Resolve an attachment to its presentation type. MIME wins when it is specific
// enough (family prefixes and the exact map); otherwise the filename extension
// decides, and finally a generic file icon is the floor. `name` is optional so
// callers with only a MIME type (e.g. a stored blob) can still resolve a type.
export function getAttachmentFileType(params: {
  mimeType?: string | null | undefined;
  name?: string | null | undefined;
}): AttachmentFileType {
  const mimeType = params.mimeType?.toLowerCase() ?? null;

  if (mimeType) {
    if (mimeType.startsWith("image/")) {
      return { Icon: ImageIcon, kind: "Image", isImage: true };
    }
    if (mimeType.startsWith("audio/")) {
      return { Icon: FileAudioIcon, kind: "Audio", isImage: false };
    }
    if (mimeType.startsWith("video/")) {
      return { Icon: FileVideoIcon, kind: "Video", isImage: false };
    }
    const exact = MIME_EXACT.get(mimeType);
    if (exact) {
      return exact;
    }
    if (mimeType.startsWith("text/")) {
      return { Icon: FileTextIcon, kind: "Text", isImage: false };
    }
  }

  const extension = params.name ? getFileExtension(params.name) : null;
  if (extension) {
    const byExtension = EXTENSION_MAP.get(extension);
    if (byExtension) {
      return byExtension;
    }
  }

  return GENERIC_FILE_TYPE;
}
