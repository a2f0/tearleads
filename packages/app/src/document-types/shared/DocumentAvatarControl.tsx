import type { Icon } from "@phosphor-icons/react";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import { useMemo, useRef } from "react";
import { MiniAppSelectMenu } from "../../components/mini-app/controls/MiniAppSelectMenu";
import { MiniAppStatus } from "../../components/mini-app/MiniAppLayout";
import { useAppHostConfig } from "../../providers/host/AppHostConfigProvider";
import { ContactAvatar } from "../contact/ContactAvatar";
import { ContactAvatarEditorDialog } from "../contact/ContactAvatarEditorDialog";
import { AttachmentActionButton } from "./AttachmentActionButton";
import type { AvatarSource } from "./avatarPickerMachine";
import type { AvatarChoice } from "./documentPhotos";
import { useAvatarPicker } from "./useAvatarPicker";

const AVATAR_LABELS = {
  altPrefix: "Avatar for",
  cameraError: "Could not capture a photo. Check camera access and try again.",
  choosePhoto: "Choose Photo",
  remove: "Remove Avatar",
  replace: "Replace Avatar",
  set: "Set Avatar",
  takePhoto: "Take Photo",
} as const;

interface AvatarControlProps {
  avatarUrl: string | null | undefined;
  canEdit: boolean;
  displayName: string;
  hasAvatar: boolean;
  onApplyAvatar: (choice: Exclude<AvatarChoice, null>) => Promise<void> | void;
  onRemoveAvatar: () => void | Promise<void>;
  photos?: readonly DocumentAttachment[];
  photoUrls?: Readonly<Record<string, string | undefined>>;
  selectedSlotId?: string | undefined;
  onChoosePhoto?: (photo: DocumentAttachment) => Promise<AvatarSource | null>;
  fallbackIcon?: Icon | undefined;
}

function AvatarPhotoSelect({
  photos,
  value,
  disabled,
  choose,
  photoUrls,
}: {
  photos: readonly DocumentAttachment[];
  value?: string | undefined;
  disabled: boolean;
  choose: (photo: DocumentAttachment) => void;
  photoUrls: Readonly<Record<string, string | undefined>> | undefined;
}) {
  return (
    <MiniAppSelectMenu
      ariaLabel="Avatar photo"
      placeholder="Choose from photos"
      portaled
      disabled={disabled}
      value={value ?? ""}
      options={photos.map((photo, index) => ({
        id: photo.slotId,
        label: `Photo ${index + 1} · ${photo.name}`,
        icon: photoUrls?.[photo.slotId] && (
          <img
            alt=""
            className="avatar-photo-option"
            src={photoUrls[photo.slotId]}
          />
        ),
      }))}
      onChange={(slotId) => {
        const photo = photos.find((item) => item.slotId === slotId);
        if (photo) choose(photo);
      }}
    />
  );
}

function croppedChoice(
  { blob, photo }: AvatarSource,
  crop: Blob,
): NonNullable<AvatarChoice> {
  if (photo)
    return {
      slotId: photo.slotId,
      crop: { bytes: crop, sourceDigest: photo.contentSha256 },
    };
  return {
    photo: {
      bytes: blob,
      mimeType: blob.type || "image/png",
      name: blob instanceof File ? blob.name : "Camera photo",
    },
    crop,
  };
}

function AvatarActions({
  hasAvatar,
  onRemoveAvatar,
  photos = [],
  photoUrls,
  selectedSlotId,
  onChoosePhoto,
  picker,
  editorTitle,
}: AvatarControlProps & {
  picker: ReturnType<typeof useAvatarPicker>;
  editorTitle: string;
}) {
  const { createScanner } = useAppHostConfig();
  const scanner = useMemo(() => createScanner?.(), [createScanner]);
  const { state, dispatch, load, save } = picker;
  const inputRef = useRef<HTMLInputElement>(null);
  const capturing = state.status === "loading";
  function capture() {
    if (!scanner || capturing) return;
    void load(async () => {
      const blob = await scanner.capturePhoto();
      return blob ? { blob } : null;
    }, AVATAR_LABELS.cameraError);
  }
  return (
    <>
      <div className="contact-avatar-control-actions">
        {photos.length > 0 && onChoosePhoto && (
          <AvatarPhotoSelect
            photos={photos}
            photoUrls={photoUrls}
            value={selectedSlotId}
            disabled={capturing}
            choose={(photo) => {
              void load(
                () => onChoosePhoto(photo),
                "Could not load the selected photo.",
              );
            }}
          />
        )}
        {scanner ? (
          <AttachmentActionButton
            disabled={capturing}
            label={AVATAR_LABELS.takePhoto}
            onClick={capture}
          />
        ) : null}
        <AttachmentActionButton
          disabled={capturing}
          label={scanner ? AVATAR_LABELS.choosePhoto : editorTitle}
          onClick={() => inputRef.current?.click()}
        />
        {hasAvatar ? (
          <AttachmentActionButton
            label={AVATAR_LABELS.remove}
            disabled={capturing}
            onClick={() => save(onRemoveAvatar)}
          />
        ) : null}
      </div>
      <input
        disabled={capturing}
        accept="image/*"
        aria-label={scanner ? AVATAR_LABELS.choosePhoto : editorTitle}
        className="contact-avatar-control-file-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) dispatch({ type: "pick", source: { blob: file } });
        }}
        ref={inputRef}
        type="file"
      />
    </>
  );
}

export function DocumentAvatarControl(props: AvatarControlProps) {
  const {
    avatarUrl,
    displayName,
    fallbackIcon,
    hasAvatar,
    canEdit,
    onApplyAvatar,
  } = props;
  const picker = useAvatarPicker();
  const { state, dispatch, save } = picker;
  const editorTitle = hasAvatar ? AVATAR_LABELS.replace : AVATAR_LABELS.set;
  return (
    <div className="contact-avatar-control">
      <ContactAvatar
        alt={`${AVATAR_LABELS.altPrefix} ${displayName}`.trim()}
        fallbackIcon={fallbackIcon}
        imageUrl={avatarUrl}
        size="large"
      />
      {canEdit && (
        <AvatarActions {...props} picker={picker} editorTitle={editorTitle} />
      )}
      {state.status === "failed" ? (
        <MiniAppStatus role="alert" tone="error">
          {state.message}
        </MiniAppStatus>
      ) : null}
      {canEdit && state.status === "editing" ? (
        <ContactAvatarEditorDialog
          onCancel={() => dispatch({ type: "close" })}
          onConfirm={(crop) =>
            save(() => onApplyAvatar(croppedChoice(state.source, crop)))
          }
          source={state.source.blob}
          title={editorTitle}
        />
      ) : null}
    </div>
  );
}
