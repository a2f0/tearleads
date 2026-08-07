import { FileAudioIcon } from "@phosphor-icons/react/dist/csr/FileAudio";
import {
  createFileDocumentType,
  readAudioDocumentFieldsFromRecord,
} from "../shared/fileDocumentDefinition";

export const AUDIO_DOCUMENT_KIND = "audio";
const AUDIO_DOCUMENT_UNTITLED_TITLE = "Untitled audio";

export const audioDocumentProjectorDefinition = createFileDocumentType({
  createIcon: FileAudioIcon,
  createLabel: "Audio",
  kind: AUDIO_DOCUMENT_KIND,
  label: "audio",
  readFields: readAudioDocumentFieldsFromRecord,
  untitledTitle: AUDIO_DOCUMENT_UNTITLED_TITLE,
});
