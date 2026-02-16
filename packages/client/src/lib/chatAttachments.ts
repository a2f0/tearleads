/**
 * Utilities for preparing media payloads that can be attached to AI chat.
 */

/**
 * Convert binary file data into a base64 data URL.
 */
export async function uint8ArrayToDataUrl(
  data: Uint8Array,
  mimeType: string
): Promise<string> {
  const blob = new Blob([data.slice()], { type: mimeType });
  return blobToDataUrl(blob);
}

/**
 * Convert an object URL into a base64 data URL.
 */
export async function objectUrlToDataUrl(objectUrl: string): Promise<string> {
  const response = await fetch(objectUrl);
  if (!response.ok) {
    throw new Error(`Failed to load object URL: ${response.status}`);
  }
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to convert blob to data URL'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
