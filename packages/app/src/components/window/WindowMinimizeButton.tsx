import "./WindowMinimizeButton.css";

export function WindowMinimizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="window-minimize" onClick={onClick}>
      &#8211;
    </button>
  );
}
