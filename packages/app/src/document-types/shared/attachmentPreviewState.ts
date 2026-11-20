export type PreviewResult =
  | { status: "ready"; url: string }
  | { status: "unavailable" };

export type AttachmentPreview =
  | { status: "queued" }
  | { status: "loading" }
  | PreviewResult;

export function transitionAttachmentPreview(
  current: AttachmentPreview,
  event: { status: "start" } | { status: "retry" } | PreviewResult,
): AttachmentPreview {
  if (event.status === "start")
    return current.status === "queued" ? { status: "loading" } : current;
  if (current.status !== "loading") return current;
  return event.status === "retry" ? { status: "queued" } : event;
}
