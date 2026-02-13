/**
 * Type guard to check if a value is a non-null object (record).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Assertion function to narrow Uint8Array<ArrayBufferLike> to Uint8Array<ArrayBuffer>.
 *
 * With @tsconfig/strictest, Uint8Array is typed as Uint8Array<ArrayBufferLike>
 * where ArrayBufferLike = ArrayBuffer | SharedArrayBuffer. Web Crypto API and
 * Blob constructor expect plain ArrayBuffer, not ArrayBufferLike.
 *
 * In practice, Uint8Arrays always use plain ArrayBuffer - SharedArrayBuffer
 * requires explicit opt-in and specific headers. This assertion narrows the type
 * by checking for SharedArrayBuffer rather than ArrayBuffer (since instanceof
 * ArrayBuffer can fail across realms in test environments).
 */
export function assertPlainArrayBuffer(
  arr: Uint8Array<ArrayBufferLike>
): asserts arr is Uint8Array<ArrayBuffer> {
  if (
    typeof SharedArrayBuffer !== 'undefined' &&
    arr.buffer instanceof SharedArrayBuffer
  ) {
    throw new Error(
      'Unexpected SharedArrayBuffer backing Uint8Array. This should never occur in normal operation.'
    );
  }
}
