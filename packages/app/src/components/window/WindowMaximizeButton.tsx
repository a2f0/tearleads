import "./WindowMaximizeButton.css";

export function WindowMaximizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="window-maximize" onClick={onClick}>
      &#9633;
    </button>
  );
}
