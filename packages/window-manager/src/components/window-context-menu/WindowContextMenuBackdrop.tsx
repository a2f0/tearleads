interface WindowContextMenuBackdropProps {
  onClose: () => void;
  overlayZIndex: number;
  backdropTestId?: string | undefined;
}

export function WindowContextMenuBackdrop({
  onClose,
  overlayZIndex,
  backdropTestId
}: WindowContextMenuBackdropProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="fixed inset-0 cursor-default"
      style={{ zIndex: overlayZIndex }}
      onClick={onClose}
      aria-label="Close context menu"
      data-testid={backdropTestId}
    />
  );
}
