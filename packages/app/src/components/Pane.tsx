import { useDatabase } from "../db/DatabaseProvider";
import "./Pane.css";

export function Pane({ className }: { className: string }) {
  const { id, status } = useDatabase();
  return (
    <section className={className}>
      <div className="pane-content">
        worker: {status}
        <br />
        id: {id}
      </div>
      <div className="pane-footer">Pane Footer</div>
    </section>
  );
}
