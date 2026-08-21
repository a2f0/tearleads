import type { FileSaver } from "@symcrypt/client-sdk";
import { downloadBytesAsFile } from "../utils/downloadFile";

const TEXT_ENCODER = new TextEncoder();

export function createSeedPhraseFileName(input: {
  readonly signingFingerprint: string | null;
  readonly timestamp?: Date;
}): string {
  const fingerprintPrefix = input.signingFingerprint
    ? `${input.signingFingerprint.slice(0, 12)}-`
    : "";
  const timestamp = input.timestamp ?? new Date();
  return `symcrypt-seed-phrase-${fingerprintPrefix}${timestamp
    .toISOString()
    .replaceAll(":", "-")}.txt`;
}

export function downloadSeedPhraseFile(
  fileSaver: FileSaver,
  input: {
    readonly fileName: string;
    readonly seedPhrase: string;
  },
): Promise<void> {
  return downloadBytesAsFile(fileSaver, {
    bytes: TEXT_ENCODER.encode(`${input.seedPhrase.trim()}\n`),
    fileName: input.fileName,
    mimeType: "text/plain",
  });
}

export function parseSeedPhraseFileText(text: string): string {
  return text.trim();
}
