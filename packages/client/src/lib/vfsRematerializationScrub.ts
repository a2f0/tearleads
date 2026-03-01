const MAX_MATERIALIZED_NOTE_TITLE_LENGTH = 256;
const MAX_MATERIALIZED_NOTE_CONTENT_LENGTH = 100_000;
const DEFAULT_MATERIALIZED_NOTE_TITLE = 'Untitled Note';
// biome-ignore lint/complexity/useRegexLiterals: Constructor form avoids noControlCharactersInRegex errors for control-byte ranges.
const MATERIALIZED_TEXT_CONTROL_CHARS = new RegExp(
  '[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]',
  'g'
);

function removeAsciiControlCharacters(value: string): string {
  return value.replace(MATERIALIZED_TEXT_CONTROL_CHARS, '');
}

function scrubMaterializedText(
  value: string,
  maxLength: number,
  trim: boolean
): string {
  const withoutControlChars = removeAsciiControlCharacters(value);
  const normalized = trim ? withoutControlChars.trim() : withoutControlChars;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function decodeBase64Utf8(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const missingPadding = normalized.length % 4;
  const padded =
    missingPadding === 0
      ? normalized
      : `${normalized}${'='.repeat(4 - missingPadding)}`;

  if (typeof globalThis.atob !== 'function') {
    return null;
  }

  let bytes: Uint8Array | null = null;
  try {
    const binary = globalThis.atob(padded);
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  } finally {
    bytes?.fill(0);
  }
}

export function resolveMaterializedNoteTitle(
  encryptedName: string | null | undefined
): string {
  if (typeof encryptedName !== 'string') {
    return DEFAULT_MATERIALIZED_NOTE_TITLE;
  }
  const title = scrubMaterializedText(
    encryptedName,
    MAX_MATERIALIZED_NOTE_TITLE_LENGTH,
    true
  );
  return title.length > 0 ? title : DEFAULT_MATERIALIZED_NOTE_TITLE;
}

export function resolveMaterializedNoteContent(
  encryptedPayload: string | null | undefined
): string {
  if (typeof encryptedPayload !== 'string') {
    return '';
  }

  const decoded = decodeBase64Utf8(encryptedPayload);
  if (decoded === null) {
    return '';
  }

  return scrubMaterializedText(
    decoded,
    MAX_MATERIALIZED_NOTE_CONTENT_LENGTH,
    false
  );
}
