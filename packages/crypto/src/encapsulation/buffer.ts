/** Copy into a fresh ArrayBuffer-backed Uint8Array for crypto.subtle compatibility. */
export function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buffer);
  view.set(bytes);
  return view;
}
