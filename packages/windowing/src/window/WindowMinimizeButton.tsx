export function WindowMinimizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="window-minimize"
      aria-label="Minimize window"
      title="Minimize window"
      onClick={onClick}
    >
      &#8211;
    </button>
  );
}
