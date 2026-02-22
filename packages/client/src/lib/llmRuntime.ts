// Store for the current attached image (base64 data URL)
let attachedImage: string | null = null;

/**
 * Sets the image to be attached to the next message.
 * The image should be a base64 data URL.
 */
export function setAttachedImage(image: string | null): void {
  attachedImage = image;
}

/**
 * Gets the currently attached image.
 */
export function getAttachedImage(): string | null {
  return attachedImage;
}

/**
 * Clears the attached image.
 * Called when switching instances to prevent image leakage between instances.
 */
export function clearAttachedImage(): void {
  attachedImage = null;
}
