import "./Header.css";

interface HeaderProps {
  split: boolean;
  onToggleSplit: () => void;
}

export function Header({ split, onToggleSplit }: HeaderProps) {
  return (
    <header className="header">
      <button type="button" onClick={onToggleSplit}>
        {split ? "Unsplit" : "Split"}
      </button>
    </header>
  );
}
