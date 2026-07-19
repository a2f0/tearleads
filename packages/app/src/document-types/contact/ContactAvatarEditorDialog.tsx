import { useId } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import {
  AVATAR_CROP_MAX_ZOOM,
  AVATAR_CROP_MIN_ZOOM,
  getAvatarImageLayout,
} from "./avatarCropGeometry";
import "./ContactAvatarEditorDialog.css";
import { useAvatarCropEditorState } from "./useAvatarCropEditorState";

const AVATAR_EDITOR_VIEWPORT_SIZE = 260;

const AVATAR_EDITOR_LABELS = {
  apply: "Apply",
  cancel: "Cancel",
  encodeError: "Failed to crop the avatar image.",
  hint: "Drag to position the face inside the circle. Zoom with the slider, mouse wheel, or a pinch.",
  readError: "Could not read the selected image.",
  zoom: "Zoom",
} as const;

function AvatarCropViewport({
  editor,
  hintId,
}: {
  editor: ReturnType<typeof useAvatarCropEditorState>;
  hintId: string;
}) {
  const layout = editor.imageSize
    ? getAvatarImageLayout(
        editor.imageSize,
        editor.view,
        AVATAR_EDITOR_VIEWPORT_SIZE,
      )
    : null;

  return (
    <div
      aria-describedby={hintId}
      className="contact-avatar-editor-viewport"
      ref={editor.viewportRef}
      style={{
        height: AVATAR_EDITOR_VIEWPORT_SIZE,
        width: AVATAR_EDITOR_VIEWPORT_SIZE,
      }}
      {...editor.pointerHandlers}
    >
      <img
        alt=""
        className="contact-avatar-editor-image"
        draggable={false}
        onError={editor.handleImageError}
        onLoad={editor.handleImageLoad}
        ref={editor.imageRef}
        src={editor.sourceUrl}
        style={
          layout
            ? {
                height: layout.height,
                left: layout.left,
                top: layout.top,
                width: layout.width,
              }
            : { visibility: "hidden" }
        }
      />
      <div aria-hidden className="contact-avatar-editor-mask" />
    </div>
  );
}

export function ContactAvatarEditorDialog({
  onCancel,
  onConfirm,
  source,
  title,
}: {
  onCancel: () => void;
  onConfirm: (avatarBlob: Blob) => void;
  // The picked source image (e.g. the file-input File); never mutated.
  source: Blob;
  title: string;
}) {
  const editor = useAvatarCropEditorState(source, AVATAR_EDITOR_VIEWPORT_SIZE);
  const titleId = useId();
  const zoomInputId = useId();
  const hintId = useId();
  const error =
    editor.errorKind === "read"
      ? AVATAR_EDITOR_LABELS.readError
      : editor.errorKind === "encode"
        ? AVATAR_EDITOR_LABELS.encodeError
        : null;

  async function handleApply() {
    const avatarBlob = await editor.applyCrop();
    if (avatarBlob) {
      onConfirm(avatarBlob);
    }
  }

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        aria-labelledby={titleId}
        aria-modal="true"
        className="contact-avatar-editor"
        role="dialog"
      >
        <h2 id={titleId}>{title}</h2>
        {error ? <MiniAppStatus tone="error">{error}</MiniAppStatus> : null}
        <AvatarCropViewport editor={editor} hintId={hintId} />
        <p className="contact-avatar-editor-hint" id={hintId}>
          {AVATAR_EDITOR_LABELS.hint}
        </p>
        <div className="contact-avatar-editor-zoom">
          <label htmlFor={zoomInputId}>{AVATAR_EDITOR_LABELS.zoom}</label>
          <input
            disabled={!editor.imageSize || editor.saving}
            id={zoomInputId}
            max={AVATAR_CROP_MAX_ZOOM}
            min={AVATAR_CROP_MIN_ZOOM}
            onChange={(event) =>
              editor.handleZoomChange(Number(event.target.value))
            }
            step={0.01}
            type="range"
            value={editor.view.zoom}
          />
        </div>
        <MiniAppActions>
          <MiniAppButton disabled={editor.saving} onClick={onCancel}>
            {AVATAR_EDITOR_LABELS.cancel}
          </MiniAppButton>
          <MiniAppButton
            disabled={!editor.imageSize || editor.saving}
            onClick={() => {
              void handleApply();
            }}
          >
            {AVATAR_EDITOR_LABELS.apply}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}
