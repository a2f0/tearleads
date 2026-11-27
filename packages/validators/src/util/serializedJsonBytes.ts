/** UTF-8 bytes of `text`, counted without encoding a copy of it. */
function utf8ByteLength(text: string): number {
  let bytes = text.length;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) continue;
    if (unit < 0x800) {
      bytes += 1;
      continue;
    }
    const next = text.charCodeAt(index + 1);
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      // A surrogate pair is two units and four bytes.
      bytes += 2;
      index += 1;
      continue;
    }
    bytes += 2;
  }
  return bytes;
}

/**
 * Bytes `value` takes as JSON: what a response that carries it serializes,
 * and no more than the request that carried it spent on it, since a parsed
 * value serializes in its shortest spelling.
 */
export function serializedJsonBytes(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value) ?? "");
}
