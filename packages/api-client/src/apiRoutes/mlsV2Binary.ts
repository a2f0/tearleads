export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return new Uint8Array();
  }

  try {
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const withoutPadding = normalized.replace(/=+$/u, '');
    const roundTrip = btoa(binary).replace(/=+$/u, '');
    if (roundTrip === withoutPadding) {
      return bytes;
    }
  } catch {
    // Fall through to utf-8 encoding fallback.
  }

  return new TextEncoder().encode(normalized);
}
