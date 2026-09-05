export function WindowMaximizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="window-maximize"
      aria-label="Toggle maximize window"
      title="Toggle maximize window"
      onClick={onClick}
    >
      &#9633;
    </button>
  );
}
