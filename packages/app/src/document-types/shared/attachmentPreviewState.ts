export type PreviewResult =
  | { status: "ready"; url: string }
  | { status: "unavailable" };

export type AttachmentPreview =
  | { status: "queued" }
  | { status: "loading" }
  | { status: "waiting-for-reader" }
  | PreviewResult;

export function transitionAttachmentPreview(
  current: AttachmentPreview,
  event:
    | { status: "start" }
    | { status: "retry" }
    | { status: "waiting-for-reader" }
    | PreviewResult,
): AttachmentPreview {
  if (event.status === "start")
    return current.status === "queued" ||
      current.status === "waiting-for-reader"
      ? { status: "loading" }
      : current;
  if (event.status === "waiting-for-reader")
    return current.status === "loading"
      ? { status: "waiting-for-reader" }
      : current;
  if (current.status !== "loading" && current.status !== "waiting-for-reader")
    return current;
  return event.status === "retry" ? { status: "queued" } : event;
}
