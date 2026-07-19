import type { DocumentAttachmentUpload } from "@tearleads/client-sdk";
import { type ChangeEvent, useRef, useState } from "react";
import { AttachmentActionButton } from "../shared/AttachmentActionButton";
import { ContactAvatar } from "./ContactAvatar";
import { ContactAvatarEditorDialog } from "./ContactAvatarEditorDialog";
import {
  CONTACT_AVATAR_ATTACHMENT_NAME,
  CONTACT_AVATAR_MIME_TYPE,
} from "./contactAvatarSlot";

const CONTACT_AVATAR_LABELS = {
  altPrefix: "Avatar for",
  remove: "Remove Avatar",
  replace: "Replace Avatar",
  set: "Set Avatar",
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
  const [pendingSource, setPendingSource] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorTitle = hasAvatar
    ? CONTACT_AVATAR_LABELS.replace
    : CONTACT_AVATAR_LABELS.set;

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (file) {
      setPendingSource(file);
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
          <AttachmentActionButton
            label={editorTitle}
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
        aria-label={editorTitle}
        className="contact-avatar-control-file-input"
        onChange={handleInputChange}
        ref={inputRef}
        type="file"
      />
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
