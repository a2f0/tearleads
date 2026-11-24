import type { DecodeOpts } from "qr/decode.js";

// qr@0.7.0 supports these options; bound the deeper still-photo search.
const PHOTO_DECODE_OPTIONS: DecodeOpts = { effort: Infinity, timeLimit: 250 };

/** Decode a host-captured photo locally and release its decoded pixels. */
export async function decodeRecoveryKeyPhoto(
  photo: Blob,
): Promise<string | null> {
  const { default: decodeQR } = await import("qr/decode.js");
  const bitmap = await createImageBitmap(photo);
  const canvas = document.createElement("canvas");
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image decoding is unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    try {
      return decodeQR(pixels, PHOTO_DECODE_OPTIONS);
    } catch {
      return null;
    } finally {
      pixels.data.fill(0);
    }
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
