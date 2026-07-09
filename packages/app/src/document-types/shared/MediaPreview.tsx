import { createElement } from "react";
import "./MediaPreview.css";

export type MediaPreviewKind = "audio" | "image" | "video";

function normalizeMediaMimeType(value: string | null | undefined): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function getMediaPreviewKind(
  mimeType: string | null | undefined,
): MediaPreviewKind | null {
  const normalized = normalizeMediaMimeType(mimeType);

  if (normalized.startsWith("image/")) {
    return "image";
  }

  if (normalized.startsWith("audio/")) {
    return "audio";
  }

  if (normalized.startsWith("video/")) {
    return "video";
  }

  return null;
}

export function isPreviewableMediaMimeType(
  mimeType: string | null | undefined,
): boolean {
  return getMediaPreviewKind(mimeType) !== null;
}

export function MediaPreview(params: {
  className?: string | undefined;
  kind: MediaPreviewKind;
  label: string;
  url: string;
}) {
  const className = [
    "media-preview",
    `media-preview--${params.kind}`,
    params.className,
  ]
    .filter(Boolean)
    .join(" ");

  if (params.kind === "image") {
    return <img alt={params.label} className={className} src={params.url} />;
  }

  if (params.kind === "audio") {
    return createElement("audio", {
      "aria-label": params.label,
      className,
      controls: true,
      preload: "metadata",
      src: params.url,
    });
  }

  return createElement("video", {
    "aria-label": params.label,
    className,
    controls: true,
    preload: "metadata",
    src: params.url,
  });
}
