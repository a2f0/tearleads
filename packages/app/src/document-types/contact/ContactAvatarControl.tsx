import type { DocumentAttachmentUpload } from "@tearleads/client-sdk";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { MiniAppStatus } from "../../components/mini-app/MiniAppLayout";
import { useAppHostConfig } from "../../providers/host/AppHostConfigProvider";
import { AttachmentActionButton } from "../shared/AttachmentActionButton";
import { ContactAvatar } from "./ContactAvatar";
import { ContactAvatarEditorDialog } from "./ContactAvatarEditorDialog";
import {
  CONTACT_AVATAR_ATTACHMENT_NAME,
  CONTACT_AVATAR_MIME_TYPE,
} from "./contactAvatarSlot";

const CONTACT_AVATAR_LABELS = {
  altPrefix: "Avatar for",
  cameraError: "Could not capture a photo. Check camera access and try again.",
  choosePhoto: "Choose Photo",
  remove: "Remove Avatar",
  replace: "Replace Avatar",
  set: "Set Avatar",
  takePhoto: "Take Photo",
} as const;

// The full avatar affordance for one contact: the circle (silhouette when
// unset), Set/Replace/Remove actions, the image file picker, and the crop
// editor. Hosts supply how the cropped result is persisted (contacts store
// or document attachment API).
export function ContactAvatarControl({
  avatarUrl,
  canEdit,
  displayName,
  hasAvatar,
  onApplyAvatar,
  onRemoveAvatar,
}: {
  avatarUrl: string | null | undefined;
  canEdit: boolean;
  displayName: string;
  hasAvatar: boolean;
  onApplyAvatar: (upload: DocumentAttachmentUpload) => void;
  onRemoveAvatar: () => void;
}) {
  const { createScanner } = useAppHostConfig();
  const scanner = useMemo(() => createScanner?.(), [createScanner]);
  const [captureError, setCaptureError] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [pendingSource, setPendingSource] = useState<Blob | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorTitle = hasAvatar
    ? CONTACT_AVATAR_LABELS.replace
    : CONTACT_AVATAR_LABELS.set;

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (file) {
      setCaptureError(false);
      setPendingSource(file);
    }
  }

  async function handleCapturePhoto() {
    if (!scanner || capturing) {
      return;
    }
    setCaptureError(false);
    setCapturing(true);
    try {
      const photo = await scanner.capturePhoto();
      if (photo) {
        setPendingSource(photo);
      }
    } catch (error) {
      console.error("Failed to capture a contact avatar photo:", error);
      setCaptureError(true);
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div className="contact-avatar-control">
      <ContactAvatar
        alt={`${CONTACT_AVATAR_LABELS.altPrefix} ${displayName}`.trim()}
        imageUrl={avatarUrl}
        size="large"
      />
      {canEdit ? (
        <div className="contact-avatar-control-actions">
          {scanner ? (
            <AttachmentActionButton
              disabled={capturing}
              label={CONTACT_AVATAR_LABELS.takePhoto}
              onClick={() => {
                void handleCapturePhoto();
              }}
            />
          ) : null}
          <AttachmentActionButton
            disabled={capturing}
            label={scanner ? CONTACT_AVATAR_LABELS.choosePhoto : editorTitle}
            onClick={() => inputRef.current?.click()}
          />
          {hasAvatar ? (
            <AttachmentActionButton
              label={CONTACT_AVATAR_LABELS.remove}
              onClick={onRemoveAvatar}
            />
          ) : null}
        </div>
      ) : null}
      <input
        accept="image/*"
        aria-label={scanner ? CONTACT_AVATAR_LABELS.choosePhoto : editorTitle}
        className="contact-avatar-control-file-input"
        onChange={handleInputChange}
        ref={inputRef}
        type="file"
      />
      {captureError ? (
        <MiniAppStatus role="alert" tone="error">
          {CONTACT_AVATAR_LABELS.cameraError}
        </MiniAppStatus>
      ) : null}
      {pendingSource ? (
        <ContactAvatarEditorDialog
          onCancel={() => setPendingSource(null)}
          onConfirm={(avatarBlob) => {
            onApplyAvatar({
              bytes: avatarBlob,
              mimeType: CONTACT_AVATAR_MIME_TYPE,
              name: CONTACT_AVATAR_ATTACHMENT_NAME,
            });
            setPendingSource(null);
          }}
          source={pendingSource}
          title={editorTitle}
        />
      ) : null}
    </div>
  );
}
