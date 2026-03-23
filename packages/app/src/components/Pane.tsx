import { useDatabase } from "../db/DatabaseProvider";

export function Pane({ className }: { className: string }) {
  const { status } = useDatabase();
  return (
    <section className={className}>
      <div className="pane-content">worker: {status}</div>
      <div className="pane-footer">Pane Footer</div>
    </section>
  );
}
