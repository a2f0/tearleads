export type PreviewResult =
  | { status: "ready"; url: string }
  | { status: "unavailable" };

export type AttachmentPreview =
  | { status: "queued" }
  | { status: "loading" }
  | PreviewResult;

export function transitionAttachmentPreview(
  current: AttachmentPreview,
  event: { status: "start" } | PreviewResult,
): AttachmentPreview {
  if (event.status === "start")
    return current.status === "queued" ? { status: "loading" } : current;
  return current.status === "loading" ? event : current;
}
