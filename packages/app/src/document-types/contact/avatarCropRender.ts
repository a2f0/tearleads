import {
  type AvatarCropImageSize,
  type AvatarCropView,
  getAvatarCropSourceRect,
} from "./avatarCropGeometry";
import { CONTACT_AVATAR_MIME_TYPE } from "./contactAvatarSlot";

// Cap the persisted avatar edge length; smaller source crops are kept at
// their native resolution instead of upscaling.
const CONTACT_AVATAR_OUTPUT_MAX_SIZE = 512;

function getAvatarOutputSize(sourceRectSize: number): number {
  return Math.max(
    1,
    Math.min(CONTACT_AVATAR_OUTPUT_MAX_SIZE, Math.round(sourceRectSize)),
  );
}

// Rasterize the visible crop square to a PNG blob (PNG keeps transparency of
// e.g. sticker-style sources and avoids JPEG's black-fill of alpha).
export async function renderAvatarCropToBlob(params: {
  image: CanvasImageSource;
  imageSize: AvatarCropImageSize;
  view: AvatarCropView;
  viewportSize: number;
}): Promise<Blob> {
  const { image, imageSize, view, viewportSize } = params;
  const rect = getAvatarCropSourceRect(imageSize, view, viewportSize);
  const outputSize = getAvatarOutputSize(rect.size);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.size,
    rect.size,
    0,
    0,
    outputSize,
    outputSize,
  );

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to encode the avatar image."));
      }
    }, CONTACT_AVATAR_MIME_TYPE);
  });
}
