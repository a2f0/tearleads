interface StaticStatusItem {
  readonly label: string;
  readonly value: string;
}

interface StaticStatusProps {
  readonly items: readonly StaticStatusItem[];
}

export function StaticStatus({ items }: StaticStatusProps) {
  return (
    <dl className="status-grid" aria-label="Website setup">
      {items.map((item) => (
        <div className="status-item" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
