export function WindowCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="window-close" onClick={onClick}>
      &times;
    </button>
  );
}
