import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import { type ReactNode, type RefObject, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useRoutedPaneOverlayHost } from "../../components/layout/routed/RoutedPaneOverlayHost";
import {
  MiniAppButton,
  MiniAppImageViewer,
  MiniAppModalBackdrop,
  MiniAppModalPanel,
} from "../../components/mini-app/MiniAppLayout";
import { classNames } from "../../components/shared/classNames";
// The windowed preview borrows the window manager's own close control and chrome
// classes so it tracks any change to the floating windows; pull the title-bar /
// toolbar stylesheets in directly rather than relying on a window happening to be
// mounted alongside.
import { WindowCloseButton } from "../../components/window/WindowCloseButton";
import "../../components/window/WindowTitleBar.css";
import "../../components/window/WindowToolBar.css";
import {
  useRoutedLayoutActive,
  useWindowedLayoutActive,
} from "../../navigation/useRoutedLayoutActive";
import { getAttachmentFileType } from "../shared/attachmentFileType";
import { isPdfMimeType } from "../shared/FileDocumentPdfPreview";
import { useModalEscapeAndFocusRestore } from "../shared/useModalEscapeAndFocusRestore";
import { NoteAttachmentPreviewStage } from "./NoteAttachmentPreviewStage";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";

type AttachmentFileType = ReturnType<typeof getAttachmentFileType>;

interface NoteAttachmentPreviewProps {
  attachment: DocumentAttachment;
  canRemove: boolean;
  imageUrl: string | undefined;
  storageKey: string | undefined;
  onClose: () => void;
  onDownload: (slotId: string) => void;
  onRemove: (slotId: string) => void;
}

// A labelled icon button shared by both chromes. The windowed toolbar keeps the
// window manager's own chrome class; the compact bar draws its chrome from the
// shared MiniAppButton icon-button recipe (the retained
// `note-attachment-preview-button` class is only a layout hook).
function PreviewIconButton({
  buttonRef,
  children,
  chrome = false,
  label,
  onClick,
}: {
  buttonRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  chrome?: boolean;
  label: string;
  onClick: () => void;
}) {
  if (chrome) {
    return (
      <button
        type="button"
        className="window-toolbar-button"
        onClick={onClick}
        ref={buttonRef}
        title={label}
        aria-label={label}
      >
        {children}
      </button>
    );
  }
  return (
    <MiniAppButton
      className="mini-app-icon-button note-attachment-preview-button"
      onClick={onClick}
      ref={buttonRef}
      title={label}
      aria-label={label}
    >
      {children}
    </MiniAppButton>
  );
}

// The name plus its type icon, shown at the head of either chrome. Carries the
// id the dialog is labelled by.
function PreviewHeading({
  fileType,
  name,
  titleId,
}: {
  fileType: AttachmentFileType;
  name: string;
  titleId: string;
}) {
  const { Icon } = fileType;
  return (
    <div className="note-attachment-preview-heading">
      <Icon aria-hidden size={18} />
      <span id={titleId} className="note-attachment-preview-title" title={name}>
        {name}
      </span>
    </div>
  );
}

// The bar carrying the download / remove / close actions. In the windowed shell
// it dresses as the window manager's own chrome — a title bar (the name plus
// `.window-close`) over the compact `.window-toolbar` — so the preview reads as
// one of the floating windows. The routed (touch) shell keeps the single
// compact bar, which already suits it.
function NoteAttachmentPreviewChrome({
  attachment,
  canRemove,
  closeButtonRef,
  fileType,
  onClose,
  onDownload,
  onRemove,
  titleId,
  windowed,
}: {
  attachment: DocumentAttachment;
  canRemove: boolean;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  fileType: AttachmentFileType;
  onClose: () => void;
  onDownload: (slotId: string) => void;
  onRemove: (slotId: string) => void;
  titleId: string;
  windowed: boolean;
}) {
  const heading = (
    <PreviewHeading
      fileType={fileType}
      name={attachment.name}
      titleId={titleId}
    />
  );

  const downloadButton = (chrome: boolean) => (
    <PreviewIconButton
      chrome={chrome}
      label={NOTE_DOCUMENT_LABELS.downloadAttachment(attachment.name)}
      onClick={() => onDownload(attachment.slotId)}
    >
      <DownloadSimpleIcon aria-hidden size={16} />
    </PreviewIconButton>
  );

  const removeButton = (chrome: boolean) =>
    canRemove ? (
      <PreviewIconButton
        chrome={chrome}
        label={NOTE_DOCUMENT_LABELS.removeAttachment(attachment.name)}
        onClick={() => {
          onRemove(attachment.slotId);
          onClose();
        }}
      >
        <TrashIcon aria-hidden size={16} />
      </PreviewIconButton>
    ) : null;

  const closeButton = (chrome: boolean) => (
    <PreviewIconButton
      buttonRef={closeButtonRef}
      chrome={chrome}
      label={NOTE_DOCUMENT_LABELS.previewClose}
      onClick={onClose}
    >
      <XIcon aria-hidden size={16} />
    </PreviewIconButton>
  );

  if (windowed) {
    return (
      <>
        <div className="window-titlebar">
          {heading}
          {/* The window manager's own close control, so the title-bar `×`
              matches every other floating window rather than a look-alike. */}
          <WindowCloseButton
            buttonRef={closeButtonRef}
            label={NOTE_DOCUMENT_LABELS.previewClose}
            onClick={onClose}
          />
        </div>
        <div className="window-toolbar" role="toolbar" aria-label="Toolbar">
          <div className="window-toolbar-spacer" />
          <div className="window-toolbar-actions">
            {downloadButton(true)}
            {removeButton(true)}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="note-attachment-preview-bar">
      {heading}
      <div className="note-attachment-preview-actions">
        {downloadButton(false)}
        {removeButton(false)}
        {closeButton(false)}
      </div>
    </div>
  );
}

// An enlarged look at a single attachment, opened from a tile. The chrome
// carries the download / remove / close actions so the note body stays
// uncluttered. On the desktop shell it is rendered through a portal into <body>
// so it overlays the whole window rather than being clipped by the note's scroll
// container, and closes on Escape or a backdrop click like the app's other
// modals. On the routed (tablet / mobile) shell the same portal goes into the
// main content pane instead, where sticky positioning pins it to that pane's
// scrollport so it fills the pane rather than floating over it — see
// `.note-attachment-preview-backdrop--routed` in NoteDocument.css.
function NoteAttachmentPreview({
  attachment,
  canRemove,
  imageUrl,
  storageKey,
  onClose,
  onDownload,
  onRemove,
}: NoteAttachmentPreviewProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const windowed = useWindowedLayoutActive();
  const routed = useRoutedLayoutActive();
  // The routed shell hands its content pane down (see RoutedPaneOverlayHost);
  // it is already mounted and in context by the time a preview can be opened
  // inside it, so the portal lands in the pane on the first render rather than
  // being retargeted after a frame of centered card.
  const routedPaneHost = useRoutedPaneOverlayHost().host;
  const fillsRoutedPane = routed && routedPaneHost !== null;
  const fileType = getAttachmentFileType({
    mimeType: attachment.mimeType,
    name: attachment.name,
  });

  useModalEscapeAndFocusRestore(onClose, closeButtonRef);

  return createPortal(
    <MiniAppModalBackdrop
      className={classNames(
        "note-attachment-preview-backdrop",
        fillsRoutedPane && "note-attachment-preview-backdrop--routed",
      )}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <MiniAppModalPanel
        className={classNames(
          "note-attachment-preview-panel",
          windowed &&
            !fillsRoutedPane &&
            "note-attachment-preview-panel--windowed",
          fillsRoutedPane && "note-attachment-preview-panel--routed",
          isPdfMimeType(attachment.mimeType) &&
            "note-attachment-preview-panel--pdf",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <NoteAttachmentPreviewChrome
          attachment={attachment}
          canRemove={canRemove}
          closeButtonRef={closeButtonRef}
          fileType={fileType}
          onClose={onClose}
          onDownload={onDownload}
          onRemove={onRemove}
          titleId={titleId}
          windowed={windowed && !fillsRoutedPane}
        />
        <NoteAttachmentPreviewStage
          attachment={attachment}
          fileType={fileType}
          imageUrl={imageUrl}
          storageKey={storageKey}
        />
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>,
    fillsRoutedPane ? routedPaneHost : document.body,
  );
}

/**
 * The overlay an opened attachment gets, chosen by what the attachment is.
 *
 * An image goes to the shared full-screen viewer — the same one the blob browser
 * opens — because an image is the attachment worth looking at closely, and only
 * that viewer lets a phone pinch, pan, and zoom it. PDFs render in the panel
 * preview using the shared PDF viewer. Other files keep the type icon, size,
 * and "no preview available" placeholder. An image whose
 * bytes have not arrived yet has no URL to hand the viewer, so it lands there
 * too and the panel says as much.
 *
 * Remove is deliberately absent from the image viewer: staging a removal opens
 * the confirmation dialog, which the full-screen overlay would sit on top of.
 * The tile's own trash control stays the way out — visible at rest on touch, on
 * hover or focus elsewhere.
 */
export function NoteAttachmentOverlay(props: NoteAttachmentPreviewProps) {
  const { attachment, imageUrl, onClose, onDownload } = props;
  const isImage = getAttachmentFileType({
    mimeType: attachment.mimeType,
    name: attachment.name,
  }).isImage;

  if (isImage && imageUrl) {
    return (
      <MiniAppImageViewer
        label={attachment.name}
        onClose={onClose}
        onDownload={() => onDownload(attachment.slotId)}
        url={imageUrl}
      />
    );
  }

  return <NoteAttachmentPreview {...props} />;
}
