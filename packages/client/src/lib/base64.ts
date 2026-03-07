/**
 * Convert a Uint8Array to a base64 string.
 * Uses chunked String.fromCharCode to avoid call stack limits on large files.
 */
export function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
