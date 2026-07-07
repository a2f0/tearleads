import { downloadBytesAsFile } from "../utils/downloadFile";

const TEXT_ENCODER = new TextEncoder();

export function createSeedPhraseFileName(input: {
  readonly signingFingerprint: string | null;
}): string {
  const fingerprintPrefix = input.signingFingerprint
    ? `${input.signingFingerprint.slice(0, 12)}-`
    : "";
  return `tearleads-seed-phrase-${fingerprintPrefix}${new Date()
    .toISOString()
    .replaceAll(":", "-")}.txt`;
}

export function downloadSeedPhraseFile(input: {
  readonly fileName: string;
  readonly seedPhrase: string;
}): void {
  downloadBytesAsFile({
    bytes: TEXT_ENCODER.encode(`${input.seedPhrase.trim()}\n`),
    fileName: input.fileName,
    mimeType: "text/plain",
  });
}

export function parseSeedPhraseFileText(text: string): string {
  return text.trim();
}
